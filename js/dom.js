/* ================================================================
   dom.js  — all DOM element references (populated at import time;
             module scripts are deferred so the DOM is ready)
================================================================ */
import { $ } from './utils.js';

export const dom = {
  /* Header */
  logoFallback:       $('logoFallback'),
  cameraBtnHeader:    $('cameraBtnHeader'),
  cameraBtnLabel:     $('cameraBtnLabel'),
  mobileUsersToggle:  $('mobileUsersToggle'),
  onlineBadge:        $('onlineBadge'),
  headerAvatarChip:   $('headerAvatarChip'),
  headerProfileBtn:   $('headerProfileBtn'),
  headerSettingsBtn:  $('headerSettingsBtn'),
  headerSearchBtn:    $('headerSearchBtn'),

  /* Room tabs */
  roomTabsBar:   $('roomTabsBar'),
  roomPickerBtn: $('roomPickerBtn'),
  eventsCamGrid: $('eventsCamGrid'),
  roomPickerPanel: $('roomPickerPanel'),

  /* Search */
  searchBar:     $('searchBar'),
  searchInput:   $('searchInput'),
  searchCloseBtn: $('searchCloseBtn'),

  /* Chat */
  msgsContainer:  $('msgsContainer'),
  welcomeBanner:  $('welcomeBanner'),
  typingRow:      $('typingRow'),
  typingTxt:      $('typingTxt'),

  /* Chat input */
  msgInput:         $('msgInput'),
  sendBtn:          $('sendBtn'),
  boldBtn:          $('boldBtn'),
  colorPicker:      $('colorPicker'),
  fontSizeSelect:   $('fontSizeSelect'),
  emojiPickerBtn:   $('emojiPickerBtn'),
  imageAttachBtn:   $('imageAttachBtn'),
  imageFileInput:   $('imageFileInput'),
  voiceMsgBtn:      $('voiceMsgBtn'),
  imgPreviewStrip:  $('imgPreviewStrip'),
  previewThumb:     $('previewThumb'),
  previewRemoveBtn: $('previewRemoveBtn'),
  voiceRecStrip:    $('voiceRecStrip'),
  recTimer:         $('recTimer'),
  recStopBtn:       $('recStopBtn'),
  recCancelBtn:     $('recCancelBtn'),
  emojiPanel:       $('emojiPanel'),
  emojiTabsRow:     $('emojiTabsRow'),
  emojiGrid:        $('emojiGrid'),

  /* Reply preview */
  replyPreviewBar:    $('replyPreviewBar'),
  replyPreviewAuthor: $('replyPreviewAuthor'),
  replyPreviewText:   $('replyPreviewText'),
  replyPreviewCancel: $('replyPreviewCancel'),

  /* Users panel */
  usersPanel:       $('usersPanel'),
  usersList:        $('usersList'),
  usersPanelGameContent: $('usersPanelGameContent'),
  onlineCountLabel: $('onlineCountLabel'),
  closePanelBtn:    $('closePanelBtn'),
  panelOverlay:     $('panelOverlay'),
  floatingUsersBtn: $('floatingUsersBtn'),
  floatingUsersBadge: $('floatingUsersBadge'),

  /* Games panel */
  gamesPanel:       $('gamesPanel'),
  gamesPanelBody:   $('gamesPanelBody'),
  closeGamesPanelBtn: $('closeGamesPanelBtn'),
  toggleUsersListBtn: $('toggleUsersListBtn'),

  /* Private chat */
  privateChatCont: $('privateChatCont'),
  minimisedBar:    $('minimisedBar'),
  toastCont:       $('toastCont'),

  /* Cam request overlay */
  camReqOverlay: $('camReqOverlay'),
  camReqBody:    $('camReqBody'),
  camAcceptBtn:  $('camAcceptBtn'),
  camRejectBtn:  $('camRejectBtn'),

  /* Private video call window */
  vcallWin:           $('vcallWin'),
  vcallDragHandle:    $('vcallDragHandle'),
  vcallAvatar:        $('vcallAvatar'),
  vcallName:          $('vcallName'),
  vcallStatus:        $('vcallStatus'),
  vcallHdrClose:      $('vcallHdrClose'),
  remoteVideoEl:      $('remoteVideoEl'),
  localVideoEl:       $('localVideoEl'),
  remotePlaceholder:  $('remotePlaceholder'),
  remotePHAvatar:     $('remotePHAvatar'),
  remotePHName:       $('remotePHName'),
  vcallMicBtn:        $('vcallMicBtn'),
  vcallEndBtn:        $('vcallEndBtn'),
  vcallCamBtn:        $('vcallCamBtn'),

  /* Context menu */
  ctxMenu:      $('ctxMenu'),
  ctxUserHdr:   $('ctxUserHdr'),
  ctxPrivateBtn:$('ctxPrivateBtn'),
  ctxCamBtn:    $('ctxCamBtn'),
  ctxOverlay:   $('ctxOverlay'),
  ctxIgnoreBtn: $('ctxIgnoreBtn'),
  ctxAdminActions: $('ctxAdminActions'),
  ctxKickBtn:   $('ctxKickBtn'),
  ctxMuteBtn:   $('ctxMuteBtn'),
  ctxBanBtn:    $('ctxBanBtn'),

  /* Auth modal */
  authModal:          $('authModal'),
  authTabLogin:       $('authTabLogin'),
  authTabRegister:    $('authTabRegister'),
  loginForm:          $('loginForm'),
  loginNick:          $('loginNick'),
  loginPwd:           $('loginPwd'),
  loginError:         $('loginError'),
  loginSubmitBtn:     $('loginSubmitBtn'),
  registerForm:       $('registerForm'),
  regNick:            $('regNick'),
  regPwd:             $('regPwd'),
  regPwdConfirm:      $('regPwdConfirm'),
  registerError:      $('registerError'),
  registerSubmitBtn:  $('registerSubmitBtn'),
  guestContinueBtn:   $('guestContinueBtn'),

  /* Profile modal */
  profileModal:           $('profileModal'),
  profileModalClose:      $('profileModalClose'),
  profileAvatarDisplay:   $('profileAvatarDisplay'),
  profileAvatarChangeBtn: $('profileAvatarChangeBtn'),
  profileAvatarInput:     $('profileAvatarInput'),
  profileNameInput:       $('profileNameInput'),
  profileAccountInfo:     $('profileAccountInfo'),
  profileSaveBtn:         $('profileSaveBtn'),
  profileLogoutBtn:       $('profileLogoutBtn'),
  profileSwitchToAuthBtn: $('profileSwitchToAuthBtn'),

  /* Settings modal */
  settingsModal:       $('settingsModal'),
  settingsModalClose:  $('settingsModalClose'),
  cameraDeviceSelect:  $('cameraDeviceSelect'),
  micDeviceSelect:     $('micDeviceSelect'),
  detectDevicesBtn:    $('detectDevicesBtn'),
  languageSelect:      $('languageSelect'),
  themeSelect:         $('themeSelect'),
  detectDevicesHint:   $('detectDevicesHint'),
  settingsSaveBtn:     $('settingsSaveBtn'),
  rejectedCamsSection: $('rejectedCamsSection'),
  rejectedCamsList:    $('rejectedCamsList'),
  ignoredUsersSection: $('ignoredUsersSection'),
  ignoredUsersList:    $('ignoredUsersList'),

  /* Admin panel */
  headerAdminBtn:      $('headerAdminBtn'),
  adminModal:          $('adminModal'),
  adminModalClose:     $('adminModalClose'),
  adminRoomsList:      $('adminRoomsList'),
  adminUsersList:      $('adminUsersList'),
  adminBannedList:     $('adminBannedList'),
  adminIpsList:        $('adminIpsList'),
  adminRolesList:      $('adminRolesList'),
  adminCreateRoomBtn:  $('adminCreateRoomBtn'),
  adminBlockIpBtn:     $('adminBlockIpBtn'),
  adminCreateRoleBtn:  $('adminCreateRoleBtn'),
  roomEditModal:       $('roomEditModal'),
  roomEditModalClose:  $('roomEditModalClose'),
  roomEditForm:        $('roomEditForm'),
  roomEditCancelBtn:   $('roomEditCancelBtn'),
  
  /* Action modals (kick/ban/mute) */
  kickModal:           $('kickModal'),
  kickModalClose:      $('kickModalClose'),
  kickModalUserName:   $('kickModalUserName'),
  kickDuration:        $('kickDuration'),
  kickScopeRoom:       $('kickScopeRoom'),
  kickScopeGlobal:     $('kickScopeGlobal'),
  kickConfirmBtn:      $('kickConfirmBtn'),
  kickCancelBtn:       $('kickCancelBtn'),
  
  muteModal:           $('muteModal'),
  muteModalClose:      $('muteModalClose'),
  muteModalUserName:   $('muteModalUserName'),
  muteDuration:        $('muteDuration'),
  muteScopeRoom:       $('muteScopeRoom'),
  muteScopeGlobal:     $('muteScopeGlobal'),
  muteConfirmBtn:      $('muteConfirmBtn'),
  muteCancelBtn:       $('muteCancelBtn'),
  
  banModal:            $('banModal'),
  banModalClose:       $('banModalClose'),
  banModalUserName:    $('banModalUserName'),
  banReason:           $('banReason'),
  banTypePermanent:    $('banTypePermanent'),
  banTypeTemporary:    $('banTypeTemporary'),
  banTemporaryOptions: $('banTemporaryOptions'),
  banDays:             $('banDays'),
  banConfirmBtn:       $('banConfirmBtn'),
  banCancelBtn:        $('banCancelBtn'),
  
  /* Kick/Ban overlay */
  kickBanOverlay:      $('kickBanOverlay'),
  kickBanIcon:         $('kickBanIcon'),
  kickBanTitle:        $('kickBanTitle'),
  kickBanMessage:      $('kickBanMessage'),
  kickBanMinutes:      $('kickBanMinutes'),
  kickBanExpires:      $('kickBanExpires'),
  kickBanActions:      $('kickBanActions'),
  kickBanEnterBtn:     $('kickBanEnterBtn'),
};
