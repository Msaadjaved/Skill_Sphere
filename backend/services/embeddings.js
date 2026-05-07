// Hugging Face – sentence-transformers/all-MiniLM-L6-v2
// Output: 384-dimensional float vector for semantic search

const HF_TOKEN = process.env.HF_TOKEN;

async function getEmbedding(text) {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + HF_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text.trim() }),
    }
  );

  if (!response.ok) {
    const t = await response.text();
    throw new Error("HF failed: " + t.slice(0, 200));
  }

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected: " + JSON.stringify(data).slice(0, 200));
  return Array.isArray(data[0]) ? data[0] : data;
}

module.exports = { getEmbedding };
