module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // CORS toestaan
    res.json({ message: 'Hallo vanaf de backend!' });
  };