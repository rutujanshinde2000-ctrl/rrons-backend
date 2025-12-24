const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

// Google OAuth client
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// JWT secret (use env in production)
const JWT_SECRET = process.env.JWT_SECRET || "rrons_secret_key";

/**
 * Verify Google ID token
 */
async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  return ticket.getPayload();
}

/**
 * Create JWT for logged-in user
 */
function createJWT(user) {
  return jwt.sign(
    {
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

module.exports = {
  verifyGoogleToken,
  createJWT,
};
