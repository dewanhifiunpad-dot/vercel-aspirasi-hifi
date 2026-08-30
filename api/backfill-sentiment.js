/**
 * Vercel Serverless Function - Backfill Sentiment
 *
 * Endpoint SEKALI PAKAI untuk menganalisis sentiment data lama
 * yang sudah ada di Airtable sebelum fitur ini dibuat.
 *
 * Cara pakai: buka di browser (atau curl) setelah deploy:
 *   https://domain-kamu.vercel.app/api/backfill-sentiment
 *
 * Environment Variables Required:
 * - AIRTABLE_PAT
 * - AIRTABLE_BASE_ID
 * - AIRTABLE_TABLE_NAME
 * - HUGGINGFACE_API_KEY
 *
 * PENTING: Setelah semua data lama berhasil diberi Sentiment,
 * sebaiknya hapus atau nonaktifkan file ini, supaya tidak
 * sengaja terpanggil ulang dan buang kuota HuggingFace.
 */

const LABEL_MAP = { LABEL_0: 'Positif', LABEL_1: 'Netral', LABEL_2: 'Negatif' };
const HF_MODEL_URL = 'https://router.huggingface.co/hf-inference/models/mdhugol/indonesia-bert-sentiment-classification';

async function analisisSentiment(teks) {
  const response = await fetch(HF_MODEL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: teks }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  const prediksi = data[0];
  const terbaik = prediksi.reduce((a, b) => (a.score > b.score ? a : b));
  return {
    sentiment: LABEL_MAP[terbaik.label] || terbaik.label,
    confidence: Math.round(terbaik.score * 1000) / 1000,
  };
}

// jeda kecil antar request supaya tidak membanjiri HuggingFace sekaligus
function tunggu(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

  if (!AIRTABLE_PAT || !BASE_ID || !TABLE_NAME) {
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const AIRTABLE_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}`;

  try {
    // 1. Ambil semua record dari Airtable
    const getResponse = await fetch(AIRTABLE_URL, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    });
    const data = await getResponse.json();
    const records = data.records || [];

    // 2. Filter yang belum punya Sentiment
    const belumDianalisis = records.filter((r) => !r.fields['Sentiment']);

    const hasil = { total: records.length, diproses: 0, gagal: 0, detail: [] };

    // 3. Proses satu per satu (bukan paralel, supaya tidak membanjiri HuggingFace)
    for (const record of belumDianalisis) {
      const teks = record.fields['Isi Aspirasi'] || '';
      if (!teks) continue;

      try {
        const { sentiment, confidence } = await analisisSentiment(teks);

        // 4. Update record di Airtable
        const patchResponse = await fetch(`${AIRTABLE_URL}/${record.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${AIRTABLE_PAT}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: { Sentiment: sentiment, Confidence: confidence },
            typecast: true, // izinkan Airtable buat opsi baru di Single Select kalau belum ada
          }),
        });

        if (!patchResponse.ok) {
          const errText = await patchResponse.text();
          throw new Error(errText);
        }

        hasil.diproses++;
        hasil.detail.push({ id: record.id, sentiment, confidence });
      } catch (err) {
        hasil.gagal++;
        hasil.detail.push({ id: record.id, error: err.message });
      }

      await tunggu(300); // jeda 300ms antar request
    }

    return res.status(200).json(hasil);
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}