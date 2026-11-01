'use strict';
// Public half of the offline update-signing key. The private key is never
// committed; see scripts/update-keygen.js for how this pair is produced.
const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAOP6iLhGptVkD6ILViiB6fVFrfe0QatCF0c1Y5YNoYwE=
-----END PUBLIC KEY-----
`;

module.exports = { UPDATE_PUBLIC_KEY };
