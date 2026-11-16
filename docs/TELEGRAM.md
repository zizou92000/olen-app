# Telegram : les agents te préviennent et tu décides

Quand un agent (OpenClaw, Uly…) propose une mission, pose une question, livre ou échoue, le Cockpit t'écrit sur Telegram. Sous chaque proposition : **[✅ Oui] [❌ Non] [⏰ Plus tard] [🚫 Jamais]**. Pour une question, réponds directement au message. Pas de message entre 22 h et 8 h (heure de Paris) : un récapitulatif part à 8 h (`/api/agents-notify`). Écrire n'importe quoi au bot renvoie ce qui t'attend.

Pas de fenêtre de 24 h ni de modèle à faire valider, contrairement à WhatsApp (`docs/WHATSAPP.md`). Si Telegram et WhatsApp sont tous deux reliés, Telegram passe en premier.

## Mise en place (une fois)

1. Dans Telegram, écris à [@BotFather](https://t.me/BotFather), envoie `/newbot`, choisis un nom et un identifiant finissant par `bot`. Il te donne un **jeton** (`123456:ABC…`) : ne le partage nulle part.
2. Ajoute-le dans Vercel, environnement Production : `vercel env add TELEGRAM_BOT_TOKEN production` (la valeur est demandée dans ton terminal), ou sur la page Environment Variables du projet. `TELEGRAM_WEBHOOK_SECRET` est une valeur aléatoire à toi (lettres, chiffres, `_` et `-`). Redéploie.
3. Cockpit → **Intégrations → Telegram · agents** : « Connecter le bot » (enregistre le webhook), puis « Relier mon Telegram » et ouvre le lien affiché.
4. « Tester » envoie un message sur ton Telegram.

## Garde-fous

- Seul le chat relié par un **code à usage unique** (15 min, généré dans l'app) est écouté. Les autres chats, les groupes et les messages sans le secret du webhook sont ignorés.
- Chaque update Telegram n'est traitée qu'une fois (`update_id`).
- Les agents n'ont aucun outil de messagerie et ne peuvent ni lire ni changer ces réglages : ils sont dans tes réglages privés (`settings.telegramChatId`).
- Le message ne contient que le titre, le dossier et le type de la mission, sans lien.
- Le jeton du bot est retiré de tout message d'erreur.

Fichiers : `server/telegram/core.js` (envoi, boutons), `server/telegram/agents.js` (décisions), `api/telegram/webhook.js`, `api/telegram/setup.js`, `src/components/integrations/TelegramAgents.jsx`.
