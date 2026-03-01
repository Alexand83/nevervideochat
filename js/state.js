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
  localStream:      null,
  cameraClosedAt:   0,
  cameraRoom:       null,   /* room where the camera is currently active */

  /* WebRTC */
  outgoingPCs:         {},
  incomingPCs:         {},
  privatePeer:         null,
  activeCallUID:       null,
  streamOpenedForCall: false,

  /* Cam viewers tracking */
  camViewers: {},

  /* Block / ignore lists (loaded from localStorage in finishInit) */
  pendingCamRequests: {},
  rejectedCamUsers:   {},
  ignoredUsers:       {},

  /* Quote reply context */
  replyTo: null,

  /* Typing */
  typingTimer: null,

  /* Presence leave debounce */
  presenceLeaveTimers: {},

  /* Context menu */
  contextTargetUID: null,

  /* Supabase channels (global) */
  supa:     null,
  signalCh: null,   /* global broadcast channel for WebRTC/PM */

  /* Web Audio */
  audioCtx: null,

  /* Device settings */
  settings: {},
};
