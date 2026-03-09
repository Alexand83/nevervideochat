# NeverVideoChat — Firestore collections (mappatura da Supabase)

Dopo aver eseguito **setup-firebase.html** avrai queste collezioni con i dati iniziali.

## Collezioni

| Collezione         | Document ID        | Campi principali |
|--------------------|--------------------|------------------|
| **rooms**          | "1", "2", ...      | name, icon, is_open, password, max_cams, is_games_room, created_by, created_at, updated_at |
| **themes**         | "dark", "light", "blue", "purple" | name, display_name, colors (map), is_default, is_custom |
| **custom_roles**    | "owner", "admin", "moderator", "user", "guest" | name, color, permissions (map) |
| **profiles**        | uid (Firebase Auth) | username, display_name, avatar_url, is_guest, role, custom_role_id, email, language, theme_id, created_at, updated_at |
| **messages**        | auto-ID             | user_id, username, content, room_id, reactions (map), created_at, deleted_at, edited_at, ... |
| **banned_users**    | auto-ID (query per user_id) | user_id, username, reason, banned_by, banned_at, expires_at |
| **banned_ips**      | auto-ID             | ip, reason, banned_by, banned_at, expires_at |
| **kicked_users**    | auto-ID             | user_id, room_id, kicked_by, kicked_at, expires_at |
| **muted_users**     | auto-ID             | user_id, room_id (null = global), muted_by, muted_at, expires_at |
| **active_sessions** | user_id             | session_id, updated_at |
| **active_games**    | auto-ID             | room_id, game_type, game_state (map), host_id, started_at, ended_at, is_active |
| **game_scores**     | auto-ID             | user_id, username, room_id, game_type, score, games_played, wins, created_at, updated_at |
| **admin_logs**      | auto-ID             | admin_id, admin_name, action, target_type, target_id, target_name, details, ip_address, created_at |
| **announcements**   | auto-ID             | title, content, type, is_active, is_persistent, priority, created_by, created_at, expires_at |
| **reported_messages** | auto-ID           | message_id, reported_by, reason, status, reviewed_by, reviewed_at, created_at |
| **filtered_words**  | auto-ID             | word, action, replacement, created_by, created_at, updated_at |

## Storage

- **Bucket**: `chat-media` (o il default del progetto)
- **Path**: `avatars/{userId}/{filename}`, `uploads/{filename}` — come in Supabase.

## Note

- Le “tabelle” Supabase diventano **collezioni** Firestore; le righe diventano **documenti**.
- I riferimenti tra tabelle (es. `room_id`, `user_id`) restano stringhe o ID documento.
- Per **presenza** e **broadcast** (typing, WebRTC, cam-req, ecc.) andrà usato **Firebase Realtime Database** o **Firestore** con listener su documenti dedicati (la conversione completa dell’app le introdurrà).
