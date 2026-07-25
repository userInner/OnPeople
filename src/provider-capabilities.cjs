const IMAGE_MODELS = Object.freeze({
  onpeople: "gpt-image-2",
  openai: "gpt-image-2",
  sub2api: "gpt-image-2",
  compatible: "gpt-image-2",
});

function imageGenerationCapability(providerType, hasApiKey) {
  const model = IMAGE_MODELS[String(providerType || "")] || null;
  if (!model) {
    return {
      available: false,
      model: null,
      reason: "当前 Provider 只声明了文本或视觉输入能力，没有兼容的 Images API",
    };
  }
  if (!hasApiKey) {
    return {
      available: false,
      model,
      reason: "请先保存支持 /images/generations 的 Router API Key",
    };
  }
  return { available: true, model, reason: null };
}

module.exports = { IMAGE_MODELS, imageGenerationCapability };
