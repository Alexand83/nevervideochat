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
  onlineCountLabel: $('onlineCountLabel'),
  closePanelBtn:    $('closePanelBtn'),
  panelOverlay:     $('panelOverlay'),

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
  detectDevicesHint:   $('detectDevicesHint'),
  settingsSaveBtn:     $('settingsSaveBtn'),
  rejectedCamsSection: $('rejectedCamsSection'),
  rejectedCamsList:    $('rejectedCamsList'),
  ignoredUsersSection: $('ignoredUsersSection'),
  ignoredUsersList:    $('ignoredUsersList'),
};
