/**
 * Vercel Serverless Function - Airtable API Proxy
 * 
 * Environment Variables Required (set in Vercel Dashboard):
 * - AIRTABLE_PAT
 * - AIRTABLE_BASE_ID
 * - AIRTABLE_TABLE_NAME
 * - HUGGINGFACE_API_KEY
 */

const LABEL_MAP = { LABEL_0: 'Positif', LABEL_1: 'Netral', LABEL_2: 'Negatif' };
const HF_MODEL_URL = 'https://router.huggingface.co/hf-inference/models/mdhugol/indonesia-bert-sentiment-classification';

async function analisisSentiment(teks) {
  try {
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
      console.error('HF sentiment error:', data.error);
      return { sentiment: null, confidence: null };
    }
    const prediksi = data[0];
    const terbaik = prediksi.reduce((a, b) => (a.score > b.score ? a : b));
    return {
      sentiment: LABEL_MAP[terbaik.label] || terbaik.label,
      confidence: Math.round(terbaik.score * 1000) / 1000,
    };
  } catch (err) {
    console.error('Gagal analisis sentiment:', err.message);
    return { sentiment: null, confidence: null }; // gagal tidak boleh menggagalkan submit
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

  if (!AIRTABLE_PAT || !BASE_ID || !TABLE_NAME) {
    console.error('Missing environment variables');
    return res.status(500).json({ error: 'Server configuration error. Please contact administrator.' });
  }

  const AIRTABLE_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}`;

  try {
    if (req.method === 'GET') {
      const sortedUrl = `${AIRTABLE_URL}?sort[0][field]=Tanggal%20Pengirim&sort[0][direction]=desc`;
      const response = await fetch(sortedUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Airtable GET error:', response.status, errorText);
        return res.status(response.status).json({ error: 'Failed to fetch data from Airtable', details: errorText });
      }
      const data = await response.json();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      // Sisipkan hasil sentiment analysis ke tiap record sebelum dikirim ke Airtable
      const records = req.body.records || [];
      const recordsWithSentiment = await Promise.all(
        records.map(async (record) => {
          const teks = record.fields['Isi Aspirasi'] || '';
          const { sentiment, confidence } = await analisisSentiment(teks);
          return {
            ...record,
            fields: {
              ...record.fields,
              ...(sentiment ? { Sentiment: sentiment } : {}),
              ...(confidence !== null ? { Confidence: confidence } : {}),
            },
          };
        })
      );

      const response = await fetch(AIRTABLE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: recordsWithSentiment }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Airtable POST error:', response.status, errorText);
        return res.status(response.status).json({ error: 'Failed to create record in Airtable', details: errorText });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}