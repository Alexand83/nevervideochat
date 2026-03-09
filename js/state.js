/* ================================================================
   state.js  — single shared mutable application state
================================================================ */
export const state = {
  currentUser: null,
  users:       [],

  /* Rooms: { [roomId]: { id, name, icon, messages, presenceCh, dbSub, users, unreadCount } } */
  rooms:      {},
  activeRoom: 'general',

  /* Rich-text */
  isBold: false, currentColor: '#e6edf3', fontSize: '3',

  /* Pending image / voice */
  pendingImage:      null,
  mediaRecorder:     null,
  recordingChunks:   [],
  recordingTimer:    null,
  recordingSeconds:  0,

  /* Camera */
  cameraWindows:    {},
  micAnalysers:     {},
  remoteMicAnalysers: {},
  localStream:      null,
  cameraClosedAt:   0,
  cameraRoom:       null,   /* room where the camera is currently active */

  /* WebRTC */
  outgoingPCs:         {},
  incomingPCs:         {},
  pendingIncomingICE:   {}, /* { [fromUid]: RTCIceCandidate[] } — ICE (dir out) arrivati prima dell'offer, da flushare quando si crea incoming PC */
  _incomingOfferDone:   {}, /* { [fromUid]: Promise } — serializza gestione offer per peer (Firebase replay) */
  privatePeer:         null,
  activeCallUID:       null,
  streamOpenedForCall: false,

  /* Cam viewers tracking */
  camViewers: {},
  
  /* Track manually closed cameras - prevent auto-reopening */
  manuallyClosedCameras: {},  /* { [userId]: true } - cameras closed by user, don't auto-reopen */
  
  /* Track cameras that were opened via broadcast - prevent sync from overwriting */
  camerasOpenedViaBroadcast: {},  /* { [userId]: timestamp } - cameras opened via cam-opened broadcast */

  /* Block / ignore lists (loaded from localStorage in finishInit) */
  pendingCamRequests: {},
  rejectedCamUsers:   {},
  ignoredUsers:       {},

  /* Muted/Kicked/Banned users cache (loaded from DB) */
  mutedUsers:         {},  /* { userId: { room_id: null|string, expires_at: string|null } } */
  kickedUsers:        {},  /* { userId: { [roomId]: expires_at } } */
  bannedUsers:        {},  /* { userId: { expires_at: string|null } } */

  /* Quote reply context */
  replyTo: null,

  /* Typing: { [userId]: { name, roomId } } — chi sta scrivendo per stanza */
  typingTimer: null,
  typingUsers: {},

  /* Presence leave debounce */
  presenceLeaveTimers: {},
  /* Quando abbiamo rimosso un utente dalla room (leave/sync timer): { 'roomId:uid': timestamp }. Usato per non mostrare toast "joined" al rientro dopo breve disconnect. */
  presenceLeftAt: {},

  /* Context menu */
  contextTargetUID: null,

  /* Stato "video off" ricevuto via broadcast (cam-video-off / cam-opened) per finestre remote */
  remoteVideoOffState: {},  /* { [remoteUid]: true|false } */

  /* Backend: Firebase nativo (state.fb). state.supa solo se si usa supabase-client.js */
  fb:       null,   /* { auth, firestore, rtdb, storageRef } dopo init */
  supa:     null,   /* impostato solo da supabase-client.js (backend alternativo) */
  signalCh: null,   /* global broadcast channel for WebRTC/PM */
  pendingSessionInvalidation: null, /* queue session-invalidated to send after connect */

  /* Web Audio */
  audioCtx: null,

  /* Device settings */
  settings: {},
};
