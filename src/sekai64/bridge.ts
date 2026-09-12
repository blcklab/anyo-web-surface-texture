import type { RendererAdapter, WebSurfacePresentation } from '@blcklab/anyo'
import type { Sekai64RendererNativeAccess } from '@blcklab/anyo/renderer-sekai64'
import { createDynamicTextureCapability, type DynamicTextureCapability } from '@blcklab/sekai64/dynamic-texture'
import { Raycaster } from '@blcklab/sekai64/interaction'
import { Vector3 } from '@blcklab/sekai64/math'
import { StandardMaterial, type Texture } from '@blcklab/sekai64/materials'
import { Mesh, Node } from '@blcklab/sekai64/scene'
import type {
  TextureSurfaceBindingResult,
  TextureSurfaceDiagnostic,
  TextureSurfaceRendererBridge,
  TextureSurfaceHit,
  TextureSurfaceHitTestRequest,
  TextureSurfaceTargetBinding,
} from '../types.js'

export interface Sekai64TextureSurfaceBridgeOptions {
  readonly diagnostics?: (diagnostic: TextureSurfaceDiagnostic) => void
  readonly maxDimension?: number
  /** Optional trusted native decoration hook used by presentation packages such as @blcklab/anyo-hologram. */
  readonly decorateBinding?: (context: Sekai64TextureSurfaceDecorationContext) => Sekai64TextureSurfaceDecoration | void
}

export interface Sekai64TextureSurfaceDecorationContext {
  readonly primitiveId: string
  readonly kind: 'plane' | 'entity-slot' | 'mesh'
  readonly mesh: Mesh
  readonly originalMaterial: StandardMaterial
  readonly liveMaterial: StandardMaterial
  readonly texture: Texture
  readonly uvSet: 0 | 1
  readonly presentation: WebSurfacePresentation | undefined
  readonly access: Sekai64RendererNativeAccess
}

export interface Sekai64TextureSurfaceDecoration {
  setPresented?(presented: boolean): void
  update?(deltaSeconds: number): void
  dispose(): void
}

interface NativeTextureRenderer extends RendererAdapter {
  getNativeAccess(): Sekai64RendererNativeAccess | null
}

interface GlassBinding {
  readonly mesh: Mesh
  readonly originalMaterial: StandardMaterial
  readonly originalOwned: boolean
  readonly liveMaterial: StandardMaterial
}

export function createSekai64TextureSurfaceBridge(
  renderer: RendererAdapter,
  options: Sekai64TextureSurfaceBridgeOptions = {},
): TextureSurfaceRendererBridge | null {
  if (!isNativeTextureRenderer(renderer)) return null
  const access = renderer.getNativeAccess()
  if (!access) return null
  return new Sekai64TextureSurfaceBridge(renderer, access, options)
}

class Sekai64TextureSurfaceBridge implements TextureSurfaceRendererBridge {
  readonly backend: string
  readonly identity: object
  private readonly capability: DynamicTextureCapability
  private disposed = false

  constructor(
    private readonly renderer: NativeTextureRenderer,
    private readonly access: Sekai64RendererNativeAccess,
    private readonly options: Sekai64TextureSurfaceBridgeOptions,
  ) {
    this.backend = access.engine.renderer.backend
    this.identity = access.engine.renderer
    this.capability = createDynamicTextureCapability(access.engine.renderer, {
      ...(options.maxDimension !== undefined ? { maxDimension: options.maxDimension } : {}),
      diagnostics: diagnostic => options.diagnostics?.({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        ...(diagnostic.details ? { details: diagnostic.details } : {}),
      }),
    })
  }

  createDynamicTexture(options: Parameters<DynamicTextureCapability['create']>[0]) {
    this.assertAlive()
    return this.capability.create(options)
  }

  bindTarget(request: Parameters<TextureSurfaceRendererBridge['bindTarget']>[0]): TextureSurfaceBindingResult {
    this.assertAlive()
    if (request.resolution.kind === 'wall') {
      return failure(false, 'ANYO_TEXTURE_WALL_UNSUPPORTED', 'Semantic wall targets are not yet bound natively by the texture package.')
    }
    const requested = requestedUvSet(request.resolution)
    if (requested > 1) {
      return failure(false, 'ANYO_TEXTURE_UV_SET_UNSUPPORTED', `Sekai64 currently supports UV sets 0 and 1; received ${requested}.`, { uvSet: requested })
    }
    const uvSet = requested as 0 | 1

    const target = this.resolveTargetMesh(request)
    if (!target.ok) return target
    if (!(target.mesh.material instanceof StandardMaterial)) {
      return failure(false, 'ANYO_TEXTURE_MATERIAL_UNSUPPORTED', 'The resolved texture target does not use a Sekai64 StandardMaterial.', {
        material: target.mesh.material.constructor.name,
      })
    }
    const selectedUvs = uvSet === 1 ? target.mesh.geometry.uvs1 : target.mesh.geometry.uvs
    if (!selectedUvs) {
      return failure(false, 'ANYO_TEXTURE_TARGET_UV_MISSING', `The resolved target mesh has no UV${uvSet} coordinates.`, {
        mesh: target.mesh.name || target.mesh.id,
        uvSet,
      })
    }

    const presentation = request.primitive.webSurface?.presentation
    const glass = this.resolveGlassBinding(request, presentation, target.mesh)
    const sourcePrimitiveVisible = this.access.getPrimitiveNode(request.primitive.id)?.visible ?? request.primitive.visible
    const originalMaterial = target.mesh.material
    const liveMaterial = cloneScreenMaterial(originalMaterial, request.texture, uvSet, presentation)
    let decoration: Sekai64TextureSurfaceDecoration | undefined
    try {
      decoration = this.options.decorateBinding?.({
        primitiveId: request.primitive.id,
        kind: request.resolution.kind,
        mesh: target.mesh,
        originalMaterial,
        liveMaterial,
        texture: request.texture,
        uvSet,
        presentation,
        access: this.access,
      }) ?? undefined
    } catch (error) {
      this.report({
        severity: 'warning',
        code: 'ANYO_TEXTURE_BINDING_DECORATION_FAILED',
        message: 'An optional native texture-presentation decoration failed and was ignored.',
        primitiveId: request.primitive.id,
        details: { error: error instanceof Error ? error.message : String(error) },
      })
    }
    const binding = new Sekai64MaterialTextureBinding(
      this.renderer,
      this.access,
      request.primitive.id,
      sourcePrimitiveVisible,
      request.resolution.kind,
      target.mesh,
      originalMaterial,
      request.texture,
      liveMaterial,
      glass,
      decoration,
    )
    return { ok: true, binding }
  }

  dispose(): void {
    this.disposed = true
  }

  private resolveTargetMesh(
    request: Parameters<TextureSurfaceRendererBridge['bindTarget']>[0],
  ): { ok: true; mesh: Mesh } | Exclude<TextureSurfaceBindingResult, { ok: true }> {
    const resolution = request.resolution
    if (resolution.kind === 'wall') {
      return failure(false, 'ANYO_TEXTURE_WALL_UNSUPPORTED', 'Semantic wall targets are not yet bound natively by the texture package.')
    }
    if (resolution.kind === 'plane') {
      const node = this.access.getPrimitiveNode(request.primitive.id)
      if (!(node instanceof Mesh)) {
        return failure(true, 'ANYO_TEXTURE_PLANE_NODE_UNAVAILABLE', 'The compiled Web Surface plane is not mounted as a Sekai64 Mesh yet.', {
          primitiveId: request.primitive.id,
        })
      }
      return { ok: true, mesh: node }
    }

    const entity = resolution.entity
    const roots = entity.primitiveIds
      .map(id => this.access.getPrimitiveNode(id))
      .filter((node): node is Node => node instanceof Node)
    if (roots.length === 0) {
      return failure(true, 'ANYO_TEXTURE_TARGET_ENTITY_UNAVAILABLE', `No mounted Sekai64 node is available for target entity "${entity.id}".`, {
        entityId: entity.id,
      })
    }

    const meshName = resolution.kind === 'entity-slot' ? resolution.slot.mesh : resolution.target.mesh
    const materialSlot = resolution.kind === 'entity-slot'
      ? resolution.slot.materialSlot
      : resolution.target.materialSlot ?? 0
    const candidates = collectNamedMeshes(roots, meshName)
    const mesh = candidates[materialSlot]
    if (!mesh) {
      return failure(false, 'ANYO_TEXTURE_TARGET_MESH_NOT_FOUND', 'The requested mesh/material slot could not be resolved in the mounted model.', {
        entityId: entity.id,
        mesh: meshName,
        materialSlot,
        availableMeshes: candidates.map(candidate => candidate.name || candidate.id),
      })
    }
    return { ok: true, mesh }
  }

  private resolveGlassBinding(
    request: Parameters<TextureSurfaceRendererBridge['bindTarget']>[0],
    presentation: WebSurfacePresentation | undefined,
    targetMesh: Mesh,
  ): GlassBinding | undefined {
    const glass = presentation?.glass
    if (!glass) return undefined
    const resolution = request.resolution
    if (resolution.kind === 'wall' || resolution.kind === 'plane') {
      this.report({ severity: 'warning', code: 'ANYO_TEXTURE_GLASS_TARGET_UNAVAILABLE', message: 'Named glass overlays require an entity-slot or mesh target.', primitiveId: request.primitive.id })
      return undefined
    }
    const roots = resolution.entity.primitiveIds
      .map(id => this.access.getPrimitiveNode(id))
      .filter((node): node is Node => node instanceof Node)
    const mesh = collectNamedMeshes(roots, glass.mesh)[glass.materialSlot ?? 0]
    if (!mesh) {
      this.report({ severity: 'warning', code: 'ANYO_TEXTURE_GLASS_MESH_NOT_FOUND', message: `Glass overlay mesh "${glass.mesh}" was not found; the live screen remains available without it.`, primitiveId: request.primitive.id })
      return undefined
    }
    if (mesh === targetMesh) {
      this.report({ severity: 'warning', code: 'ANYO_TEXTURE_GLASS_TARGET_CONFLICT', message: 'Glass overlay mesh resolves to the live screen mesh and was ignored.', primitiveId: request.primitive.id })
      return undefined
    }
    if (!(mesh.material instanceof StandardMaterial)) {
      this.report({ severity: 'warning', code: 'ANYO_TEXTURE_GLASS_MATERIAL_UNSUPPORTED', message: 'The glass overlay mesh does not use a Sekai64 StandardMaterial.', primitiveId: request.primitive.id })
      return undefined
    }
    return {
      mesh,
      originalMaterial: mesh.material,
      originalOwned: mesh.ownsMaterial,
      liveMaterial: cloneGlassMaterial(mesh.material, glass.opacity ?? 0.2),
    }
  }

  private report(diagnostic: TextureSurfaceDiagnostic): void {
    this.options.diagnostics?.(Object.freeze({ ...diagnostic }))
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('Sekai64 texture-surface bridge is disposed.')
  }
}

class Sekai64MaterialTextureBinding implements TextureSurfaceTargetBinding {
  readonly texture: Texture
  readonly kind: 'plane' | 'entity-slot' | 'mesh'
  private readonly originalOwned: boolean
  private disposed = false
  private presentedValue = false
  private readonly raycaster = new Raycaster()

  constructor(
    private readonly renderer: RendererAdapter,
    private readonly access: Sekai64RendererNativeAccess,
    private readonly sourcePrimitiveId: string,
    private readonly sourcePrimitiveVisible: boolean,
    kind: 'plane' | 'entity-slot' | 'mesh',
    private readonly mesh: Mesh,
    private readonly originalMaterial: StandardMaterial,
    texture: Texture,
    private readonly liveMaterial: StandardMaterial,
    private readonly glass?: GlassBinding,
    private readonly decoration?: Sekai64TextureSurfaceDecoration,
  ) {
    this.kind = kind
    this.texture = texture
    this.originalOwned = mesh.ownsMaterial
  }

  get presented(): boolean { return this.presentedValue }

  update(deltaSeconds: number): void {
    if (this.disposed || !this.presentedValue) return
    this.decoration?.update?.(deltaSeconds)
  }

  setPresented(presented: boolean): void {
    if (this.disposed || this.presentedValue === presented) return
    this.presentedValue = presented
    if (presented) {
      this.mesh.setMaterial(this.liveMaterial, { disposePrevious: false, ownsResource: false })
      if (this.glass && !this.glass.mesh.disposed) this.glass.mesh.setMaterial(this.glass.liveMaterial, { disposePrevious: false, ownsResource: false })
      this.decoration?.setPresented?.(true)
      if (this.kind !== 'plane') this.renderer.setPrimitiveVisibility?.(this.sourcePrimitiveId, false)
      return
    }
    this.mesh.setMaterial(this.originalMaterial, { disposePrevious: false, ownsResource: this.originalOwned })
    this.restoreGlass()
    this.decoration?.setPresented?.(false)
    if (this.kind !== 'plane') this.renderer.setPrimitiveVisibility?.(this.sourcePrimitiveId, this.sourcePrimitiveVisible)
  }

  hitTest(request: TextureSurfaceHitTestRequest): TextureSurfaceHit | null {
    if (this.disposed || !this.presentedValue || this.mesh.disposed || !this.mesh.worldVisible) return null
    this.access.scene.updateWorldMatrix()
    if (request.type === 'screen') {
      const rect = this.renderer.canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      this.raycaster.setFromCamera([
        ((request.clientX - rect.left) / rect.width) * 2 - 1,
        -((request.clientY - rect.top) / rect.height) * 2 + 1,
      ], this.access.camera)
    } else {
      const direction = new Vector3(...request.direction)
      if (direction.lengthSquared() <= 1e-12) return null
      this.raycaster.ray.set(new Vector3(...request.origin), direction)
      this.raycaster.near = request.near ?? 0
      this.raycaster.far = request.far ?? Number.POSITIVE_INFINITY
    }
    const hit = this.raycaster.intersectMesh(this.mesh, 'triangles')
    if (!hit) return null
    if (request.type === 'ray' && (hit.distance < (request.near ?? 0) || hit.distance > (request.far ?? Number.POSITIVE_INFINITY))) return null
    const uv = this.liveMaterial.baseColorTexCoord === 1 ? hit.uv1 : hit.uv
    if (!uv) return null
    const frontFacing = hit.normal.dot(this.raycaster.ray.direction) < 0
    if (this.liveMaterial.side === 'front' && !frontFacing) return null
    if (this.liveMaterial.side === 'back' && frontFacing) return null
    return Object.freeze({
      uv: Object.freeze([uv.x, uv.y]) as readonly [number, number],
      point: Object.freeze([hit.point.x, hit.point.y, hit.point.z]) as readonly [number, number, number],
      normal: Object.freeze([hit.normal.x, hit.normal.y, hit.normal.z]) as readonly [number, number, number],
      distance: hit.distance,
      frontFacing,
    })
  }

  dispose(): void {
    if (this.disposed) return
    if (!this.mesh.disposed) {
      this.mesh.setMaterial(this.originalMaterial, { disposePrevious: false, ownsResource: this.originalOwned })
      if (this.kind !== 'plane') this.renderer.setPrimitiveVisibility?.(this.sourcePrimitiveId, this.sourcePrimitiveVisible)
    }
    this.restoreGlass()
    this.liveMaterial.dispose()
    this.glass?.liveMaterial.dispose()
    this.decoration?.dispose()
    this.presentedValue = false
    this.disposed = true
  }

  private restoreGlass(): void {
    if (!this.glass || this.glass.mesh.disposed) return
    this.glass.mesh.setMaterial(this.glass.originalMaterial, { disposePrevious: false, ownsResource: this.glass.originalOwned })
  }
}

function cloneScreenMaterial(source: StandardMaterial, texture: Texture, uvSet: 0 | 1, presentation: WebSurfacePresentation | undefined): StandardMaterial {
  const useLiveEmissive = presentation?.emissive?.useTexture ?? Boolean(presentation?.emissive)
  return new StandardMaterial({
    label: `${source.label ?? 'material'}:anyo-web-surface`,
    baseColor: [1, 1, 1, presentation?.opacity ?? source.baseColor.a],
    baseColorTexture: texture,
    baseColorTexCoord: uvSet,
    metallic: source.metallic,
    roughness: source.roughness,
    ...(source.metallicRoughnessTexture ? { metallicRoughnessTexture: source.metallicRoughnessTexture } : {}),
    metallicRoughnessTexCoord: source.metallicRoughnessTexCoord,
    ...(source.normalTexture ? { normalTexture: source.normalTexture } : {}),
    normalTexCoord: source.normalTexCoord,
    normalScale: source.normalScale,
    emissive: presentation?.emissive?.color ?? source.emissive,
    emissiveIntensity: presentation?.emissive?.intensity ?? source.emissiveIntensity,
    ...(useLiveEmissive
      ? { emissiveTexture: texture, emissiveTexCoord: uvSet }
      : source.emissiveTexture ? { emissiveTexture: source.emissiveTexture, emissiveTexCoord: source.emissiveTexCoord } : {}),
    ...(source.occlusionTexture ? { occlusionTexture: source.occlusionTexture } : {}),
    occlusionTexCoord: source.occlusionTexCoord,
    occlusionStrength: source.occlusionStrength,
    alphaMode: presentation?.transparent || (presentation?.opacity ?? 1) < 1 ? 'blend' : source.alphaMode,
    alphaCutoff: source.alphaCutoff,
    transparent: presentation?.transparent ?? source.transparent,
    side: presentation?.side ?? source.side,
    depthWrite: presentation?.transparent || (presentation?.opacity ?? 1) < 1 ? false : source.depthWrite,
    wireframe: source.wireframe,
    ownsTextures: false,
    autoloadTextures: false,
  })
}

function cloneGlassMaterial(source: StandardMaterial, opacity: number): StandardMaterial {
  return new StandardMaterial({
    label: `${source.label ?? 'material'}:anyo-web-surface-glass`,
    baseColor: [source.baseColor.r, source.baseColor.g, source.baseColor.b, Math.max(0, Math.min(1, opacity))],
    ...(source.baseColorTexture ? { baseColorTexture: source.baseColorTexture } : {}),
    baseColorTexCoord: source.baseColorTexCoord,
    metallic: source.metallic,
    roughness: source.roughness,
    emissive: source.emissive,
    emissiveIntensity: source.emissiveIntensity,
    alphaMode: 'blend',
    transparent: true,
    side: source.side,
    depthWrite: false,
    ownsTextures: false,
    autoloadTextures: false,
  })
}

function collectNamedMeshes(roots: readonly Node[], name: string | undefined): Mesh[] {
  const matches: Node[] = []
  for (const root of roots) {
    root.traverse(node => {
      if (!name || node.name === name || node.id === name) matches.push(node)
    })
  }
  const meshes: Mesh[] = []
  const seen = new Set<Mesh>()
  for (const match of matches) {
    match.traverse(node => {
      if (node instanceof Mesh && !seen.has(node)) {
        seen.add(node)
        meshes.push(node)
      }
    })
  }
  return meshes
}

function requestedUvSet(resolution: Parameters<TextureSurfaceRendererBridge['bindTarget']>[0]['resolution']): number {
  if (resolution.kind === 'entity-slot') return resolution.slot.uvSet
  if (resolution.kind === 'mesh') return resolution.target.uvSet ?? 0
  return 0
}

function failure(
  retryable: boolean,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): Exclude<TextureSurfaceBindingResult, { ok: true }> {
  return { ok: false, retryable, code, message, ...(details ? { details } : {}) }
}

function isNativeTextureRenderer(renderer: RendererAdapter): renderer is NativeTextureRenderer {
  return typeof (renderer as Partial<NativeTextureRenderer>).getNativeAccess === 'function'
}
