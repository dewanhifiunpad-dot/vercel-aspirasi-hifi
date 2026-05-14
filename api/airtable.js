/**
 * Vercel Serverless Function - Airtable API Proxy
 * 
 * This function acts as a secure proxy between your frontend and Airtable.
 * It keeps your Airtable PAT token hidden from the client.
 * 
 * Environment Variables Required (set in Vercel Dashboard):
 * - AIRTABLE_PAT
 * - AIRTABLE_BASE_ID
 * - AIRTABLE_TABLE_NAME
 */

export default async function handler(req, res) {
  // Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Get environment variables
  const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

  // Validate environment variables
  if (!AIRTABLE_PAT || !BASE_ID || !TABLE_NAME) {
    console.error('Missing environment variables');
    return res.status(500).json({ 
      error: 'Server configuration error. Please contact administrator.' 
    });
  }

  const AIRTABLE_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}`;

  try {
    // GET request - Fetch all records
    if (req.method === 'GET') {
      const sortedUrl = `${AIRTABLE_URL}?sort[0][field]=Tanggal%20Pengirim&sort[0][direction]=desc`;
      
      const response = await fetch(sortedUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Airtable GET error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'Failed to fetch data from Airtable',
          details: errorText 
        });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }

    // POST request - Create new record
    if (req.method === 'POST') {
      const response = await fetch(AIRTABLE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Airtable POST error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'Failed to create record in Airtable',
          details: errorText 
        });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }

    // Method not allowed
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
