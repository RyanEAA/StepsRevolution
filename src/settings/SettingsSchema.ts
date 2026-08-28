import { z } from "zod";

export const SETTINGS_VERSION = 1;

export const DanceVisionSettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  input: z.object({
    mode: z.enum(["keyboard", "camera"]),
    cameraDeviceId: z.string(),
    mirrorCamera: z.boolean(),
    visibilityThreshold: z.number().min(0).max(1),
    minimumFootConfidence: z.number().min(0).max(1),
    inferenceFps: z.number().int().min(5).max(30),
  }),
  gameplay: z.object({
    playfieldWidth: z.number().int().min(400).max(1180),
  }),
  interface: z.object({
    showDiagnostics: z.boolean(),
    reducedMotion: z.boolean(),
  }),
});

export type DanceVisionSettings = z.infer<typeof DanceVisionSettingsSchema>;

export const DEFAULT_SETTINGS: DanceVisionSettings = {
  version: SETTINGS_VERSION,
  input: {
    mode: "keyboard",
    cameraDeviceId: "",
    mirrorCamera: true,
    visibilityThreshold: 0.5,
    minimumFootConfidence: 0.5,
    inferenceFps: 15,
  },
  gameplay: {
    playfieldWidth: 1180,
  },
  interface: {
    showDiagnostics: false,
    reducedMotion: false,
  },
};
