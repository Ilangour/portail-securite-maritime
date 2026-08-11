// ============================================================
//  Vérification de l'authentification Google côté serveur.
//
//  Le client envoie le jeton d'identité Google (JWT) obtenu après
//  connexion dans l'en-tête Authorization de chaque appel API — voir
//  portail.js (handleCredentialResponse). Ce module vérifie que ce
//  jeton est authentique (signature Google) et que le compte appartient
//  au domaine autorisé (celui de l'entreprise), avant de laisser passer la
//  requête vers Airtable.
//
//  Contournement de test : en dehors de Production, un jeton de test
//  fixe (E2E_TEST_BYPASS_TOKEN) est accepté sans vérification Google,
//  pour permettre aux tests automatisés (navigateur headless, aucun
//  vrai compte Google possible) de fonctionner. Ce contournement est
//  bloqué en Production quel que soit le jeton fourni (voir la
//  vérification VERCEL_ENV ci-dessous) — voir README.md.
// ============================================================
import { OAuth2Client } from 'google-auth-library';

const ALLOWED_EMAIL_DOMAIN = 'exemple-entreprise.eu'; // à remplacer par le vrai domaine de l'entreprise
// Doit rester identique à tests/_auth-helper.js (TEST_TOKEN).
const E2E_TEST_BYPASS_TOKEN = 'e2e-test-token';

const googleClient = new OAuth2Client();

export async function verifyAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, message: 'Authentification requise' };
  }

  if (process.env.VERCEL_ENV !== 'production' && token === E2E_TEST_BYPASS_TOKEN) {
    return { ok: true };
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload && payload.email ? payload.email : '';
    if (!email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
      return { ok: false, message: 'Compte non autorisé (domaine non reconnu)' };
    }
    return { ok: true, email };
  } catch {
    return { ok: false, message: 'Jeton invalide ou expiré, merci de vous reconnecter' };
  }
}
