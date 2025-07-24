// Simple test function to verify Vercel serverless functions work
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.json({ 
    success: true, 
    message: 'Vercel serverless functions are working!',
    timestamp: new Date().toISOString()
  });
};