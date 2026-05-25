export type SurfaceGenerationQuality = "draft" | "balanced" | "final";

export interface SurfaceGenerationOptions {
  quality: SurfaceGenerationQuality;
  fillHoles: boolean;
  keepLargestComponent: boolean;
  splitDisconnectedComponents: boolean;
  smoothIterations: number;
  decimateReduction: number;
}

export const SURFACE_GENERATION_PRESETS: Record<
  SurfaceGenerationQuality,
  SurfaceGenerationOptions
> = {
  draft: {
    quality: "draft",
    fillHoles: false,
    keepLargestComponent: true,
    splitDisconnectedComponents: false,
    smoothIterations: 4,
    decimateReduction: 0.35,
  },
  balanced: {
    quality: "balanced",
    fillHoles: true,
    keepLargestComponent: true,
    splitDisconnectedComponents: false,
    smoothIterations: 12,
    decimateReduction: 0.2,
  },
  final: {
    quality: "final",
    fillHoles: true,
    keepLargestComponent: false,
    splitDisconnectedComponents: false,
    smoothIterations: 24,
    decimateReduction: 0.05,
  },
};

