/**
 * MailSuite Tracker — Background Service Worker
 * Minimal: just keeps the extension alive and handles install events.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("MailSuite Tracker installed.");
});
