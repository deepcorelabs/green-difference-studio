export function detectExportSupport() {
  const hasVideoEncoder = typeof VideoEncoder !== "undefined";

  return {
    color: {
      supported: hasVideoEncoder,
      mimeType: "video/webm",
    },
    alpha: {
      supported: hasVideoEncoder,
      mimeType: "video/webm",
      note: "Exports a black & white alpha matte video.",
    },
  };
}
