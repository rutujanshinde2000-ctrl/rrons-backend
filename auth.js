const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET || "rrons_secret_key";

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: GOOGLE_CLIENT_ID
  });

  return ticket.getPayload();
}

function createJWT(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
}

module.exports = {
  verifyGoogleToken,
  createJWT
};
