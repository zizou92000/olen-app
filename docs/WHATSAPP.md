# WhatsApp Business dans le Cockpit

Les messages que tes clients envoient à ton numéro **WhatsApp Business** arrivent dans le Cockpit : page **Messages**, badge dans la barre latérale, pastilles vertes dans le bandeau « À traiter ». Tu réponds depuis la page Messages, ou tu laisses Claude / Codex répondre via le MCP.

## Comment ça marche

```
Client WhatsApp ──► Meta (API Cloud) ──► POST /api/whatsapp/webhook ──► Supabase wa_messages ──► Cockpit (temps réel)
Cockpit / MCP ──► /api/whatsapp/send ou outil repondre_whatsapp ──► Meta ──► Client
```

| Élément | Fichier |
|---|---|
| Table des messages | `supabase/migrations/007_whatsapp.sql` |
| Webhook (vérification, signature, messages, statuts) | `api/whatsapp/webhook.js` |
| Envoi depuis le Cockpit | `api/whatsapp/send.js` |
| Logique partagée (envoi, fenêtre 24 h) | `server/whatsapp/core.js`, `src/lib/whatsapp.js` |
| Outils MCP | `lister_conversations_whatsapp`, `lire_conversation_whatsapp`, `repondre_whatsapp` |

## Mise en route (une fois)

1. **Compte Meta Business** : sur [business.facebook.com](https://business.facebook.com), crée ou utilise ton portefeuille d'entreprise.
2. **App Meta** : sur [developers.facebook.com](https://developers.facebook.com/apps), crée une app de type *Business*, puis ajoute le produit **WhatsApp**.
3. **Numéro** : dans *WhatsApp → Configuration de l'API*, ajoute ton numéro professionnel et vérifie-le par SMS. Note son **Phone number ID**.
   Ce numéro ne doit pas être utilisé en même temps dans l'app WhatsApp classique.
4. **Jeton permanent** : *Paramètres de l'entreprise → Utilisateurs système* → crée un utilisateur système Admin, donne-lui l'accès à l'app et au compte WhatsApp, puis génère un jeton avec les permissions `whatsapp_business_messaging` et `whatsapp_business_management`.
5. **Variables Vercel** (*Settings → Environment Variables*, environnement Production), puis redéploie :

   | Variable | Valeur |
   |---|---|
   | `WHATSAPP_TOKEN` | le jeton permanent de l'étape 4 |
   | `WHATSAPP_PHONE_NUMBER_ID` | le Phone number ID de l'étape 3 |
   | `WHATSAPP_VERIFY_TOKEN` | une phrase secrète de ton choix (réutilisée à l'étape 6) |
   | `WHATSAPP_APP_SECRET` | *Paramètres de l'app → Général → Clé secrète* |
   | `WHATSAPP_OWNER_EMAIL` | l'email de ton compte Cockpit (celui qui reçoit les messages) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → *Project Settings → API → service_role* |

6. **Webhook** : *WhatsApp → Configuration* → URL de rappel `https://full-value-os.vercel.app/api/whatsapp/webhook`, jeton de vérification = `WHATSAPP_VERIFY_TOKEN`, puis **abonne le champ `messages`**.
7. **Base** : exécute `007_whatsapp.sql` dans le SQL Editor de Supabase.
8. **Test** : envoie un WhatsApp à ton numéro Business depuis un autre téléphone. Le message doit apparaître dans *Messages* en quelques secondes.

## Règles WhatsApp à connaître

- **Fenêtre de 24 h** : tu peux répondre librement pendant 24 h après le dernier message d'un client. Au-delà, WhatsApp n'accepte qu'un **modèle** validé par Meta. Le Cockpit bloque l'envoi hors fenêtre et l'indique sous la conversation.
- **Tarifs** : les réponses dans la fenêtre de 24 h ouverte par le client sont gratuites (règles Meta en vigueur) ; les modèles sont facturés par Meta.
- **Médias** : photos, vocaux et documents apparaissent avec leur légende ou un libellé (`[Photo]`, `[Message vocal]`…). Leur contenu n'est pas encore téléchargé dans le Cockpit.

## Avec Claude / Codex

Une fois le MCP branché (voir `docs/MCP_OPEN_SPACE.md`), par exemple : « Liste mes conversations WhatsApp non lues et propose une réponse à Julie sur le devis ». L'agent utilise `lister_conversations_whatsapp`, `lire_conversation_whatsapp` puis `repondre_whatsapp`. Chaque envoi est signé de son nom dans la conversation et tracé dans le journal d'activité.

## Agents sur WhatsApp (missions OpenClaw)

Quand un agent propose une mission, pose une question, livre ou échoue, le Cockpit t'écrit sur WhatsApp. Tu réponds depuis ton téléphone :

| Tu écris | Effet |
|---|---|
| `OUI a1b2` | approuve la mission de code `a1b2` (ou simplement `OUI` en répondant au message de l'agent) |
| `NON a1b2 raison` | la refuse |
| `PLUS TARD a1b2` | la reporte de 3 jours |
| `JAMAIS a1b2` | la refuse et l'agent ne proposera plus cette tâche |
| `REP a1b2 ta réponse` | répond à la question d'un agent |
| n'importe quoi d'autre (« bonjour ») | renvoie la liste de ce qui t'attend |

La validation d'une livraison se fait dans la page **Agents** (il faut relire le livrable). Aucun message entre 22 h et 8 h (heure de Paris) : un récapitulatif part à 8 h (cron `/api/agents-notify`).

### Deux numéros : un qui envoie, un qui reçoit

WhatsApp ne peut pas envoyer un message d'un numéro vers lui-même. Il faut donc :

- **un numéro d'envoi** branché sur l'API Cloud de Meta (`WHATSAPP_PHONE_NUMBER_ID`) : le numéro de test gratuit fourni par Meta pour commencer, puis un numéro dédié au Cockpit ;
- **ton numéro personnel** (celui de ton téléphone, même s'il porte aussi ton WhatsApp Business) : à saisir dans **Intégrations → WhatsApp Business → Agents sur WhatsApp**. Il est stocké dans tes réglages privés, jamais dans le code, et aucun outil d'agent ne peut le modifier.

Ton WhatsApp Business (l'application sur ton téléphone) continue de fonctionner normalement : rien n'y est branché.

### Fenêtre de 24 h

Le Cockpit peut t'écrire librement pendant 24 h après ton dernier message au numéro d'envoi. Au-delà, il lui faut un **modèle** validé par Meta :

- `WHATSAPP_TEMPLATE_NOTIFY` : nom du modèle (par exemple `cockpit_decision`, catégorie Utilitaire, langue Français, texte « Cockpit : {{1}} »). Le paramètre reçoit le résumé de la décision.
- `WHATSAPP_TEMPLATE_LANG` : code langue du modèle (`fr` par défaut).
- `WHATSAPP_TEMPLATE_PARAMS=0` : pour un modèle sans paramètre, comme `hello_world` (`en_US`) du numéro de test. Il sert alors de simple sonnette : tu réponds « ok » et le Cockpit t'envoie le détail.

Sans modèle, une décision arrivée hors fenêtre reste visible dans le Cockpit et part dans le récapitulatif dès que tu écris au numéro d'envoi.

### Garde-fous

- Seuls les messages signés par Meta (`WHATSAPP_APP_SECRET`) et venant de ton numéro enregistré sont lus comme des décisions ; un message déjà reçu n'est jamais rejoué.
- Le texte envoyé ne contient que le titre, le dossier et le type de la mission, sans lien.
- Les agents n'ont aucun outil de messagerie : c'est le serveur du Cockpit qui écrit.
