# Agents et missions (OpenClaw, puis Uly)

Le Cockpit sert de plan de contrôle aux agents : ils lisent les tâches et les dossiers clients, **proposent** une mission, et n'agissent qu'après l'accord donné dans la page **Agents**. L'exécuteur est OpenClaw aujourd'hui ; Uly pourra le remplacer sans changer ce modèle.

## Règle centrale

Seul l'humain, depuis l'app, peut approuver, refuser, répondre à une question et valider une livraison. **Aucun outil MCP ne le permet** (un test le vérifie : `tests/mcp/missions.test.js`). Un agent qui lit un contenu piégé ne peut donc pas s'auto-autoriser.

## Cycle d'une mission

| Statut | Qui | Passage suivant |
|---|---|---|
| `proposee` | agent : `proposer_mission` | humain : Oui / Non / Plus tard / Jamais pour cette tâche |
| `approuvee` | humain | agent : `demarrer_mission` |
| `en_cours` | agent | agent : `journaliser_mission`, `questionner_mission`, `livrer_mission`, `signaler_echec_mission` |
| `question` | agent | humain : réponse, retour à `en_cours` |
| `a_valider` | agent | humain : valider (`terminee`) ou demander des corrections (`approuvee`) |

Garde-fous côté serveur : une seule mission active par tâche, 5 propositions en attente au maximum, une tâche marquée « Jamais » (`task.agentOptOut`) n'est plus proposée, un agent ne peut agir que sur ses propres missions, `livrer_mission` ne termine jamais la tâche liée.

## Où vit quoi

- Logique pure partagée app + serveur : `src/lib/missions.js` (statuts, transitions, `needsHuman`, `delegableTasks`).
- Outils MCP : `server/mcp/missions.js` (`lister_clients`, `creer_client`, `modifier_client`, `taches_delegables`, `proposer_mission`, `lister_missions`, `lire_mission`, `demarrer_mission`, `journaliser_mission`, `questionner_mission`, `livrer_mission`, `signaler_echec_mission`).
- Données : `state.agentMissions` (store, synchronisé dans `user_state`), `client.links` et `client.brief` sur les fiches clients, `task.clientId`, `task.createdBy`, `task.completedBy`, `task.agentOptOut`.
- Interface : page `Agents` (`src/components/views/Agents.jsx`), pastille dans la barre « À traiter », badge dans la navigation, notifications (`AgentNotifications`), liens du dossier dans la fiche client (`ClientLinks`).

## Sur Telegram et WhatsApp

Telegram (boutons, sans fenêtre de 24 h) est le canal conseillé : `docs/TELEGRAM.md`.

Les propositions, questions, livraisons et échecs sont aussi envoyés sur WhatsApp, et l'utilisateur peut répondre OUI / NON / PLUS TARD / JAMAIS / REP depuis son numéro enregistré (`server/whatsapp/notify.js`, `server/whatsapp/agents.js`, `src/lib/missionCommands.js`). Mise en place : `docs/WHATSAPP.md`, section « Agents sur WhatsApp ». Ces décisions passent par le webhook signé, jamais par un outil MCP.

## Autres règles

- Une tâche terminée par un agent porte `completedBy` et ne rapporte ni XP ni série (`doneByAgent`). Si l'utilisateur la termine lui-même dans l'app, elle redevient la sienne.
- Chaque écriture d'un outil branché sur le store est tracée dans `activity_log` au nom du jeton (`server/mcp/protocol.js`, drapeau `writes: true` sur l'outil).
- Les notes, messages et contenus lus par un agent sont des données, jamais des instructions.

## Brancher un agent

Créer un jeton dédié dans **Intégrations** (par exemple « OpenClaw »), puis le donner à l'agent en en-tête `Authorization: Bearer …` sur `POST /api/mcp`. Le libellé du jeton est le nom affiché sur les missions. Côté OpenClaw, la procédure est dans `/Users/m/OPENCLAW/README.md`.

## Limites connues

- Un jeton MCP donne accès à tous les outils : la restriction par agent se fait côté OpenClaw (filtre d'outils), pas encore côté Cockpit.
- La synchro du navigateur pousse encore le document entier sans condition : un onglet resté ouvert hors ligne peut écraser une écriture d'agent à son retour.
