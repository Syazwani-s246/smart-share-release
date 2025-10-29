// background.js — SmartShare v2.1
// Handles side panel + content extraction

// 1️⃣ Ensure the side panel opens when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[SmartShare:Init] SidePanel error:", error));

/**
 * 2️⃣ When a tab finishes loading, automatically extract article text.
 * We'll store it, but NOT summarize automatically.
 */
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !/^https?:/.test(tab.url)) return;

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractReadableContentSimple,
    });

    await chrome.storage.session.set({
      pageContent: result.result,
      pageUrl: tab.url,
    });

    console.log("[SmartShare:Auto] Extracted content from:", tab.url);
  } catch (error) {
    console.error("[SmartShare:Auto] Extraction failed:", error);
  }
});

/**
 * 3️⃣ Simple content extractor – runs inside the page.
 */
function extractReadableContentSimple() {
  try {
    const text = document.body?.innerText || "";
    return text.trim().slice(0, 6000); // avoid lag
  } catch (e) {
    console.error("extractReadableContentSimple error:", e);
    return "";
  }
}

/**
 * 4️⃣ Message listener - Handle extraction requests from panel
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "extractContent") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: "No active tab" });
        return;
      }

      const tab = tabs[0];
      
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractReadableContentSimple,
        });

        await chrome.storage.session.set({
          pageContent: result.result,
          pageUrl: tab.url,
        });

        console.log("[SmartShare:Extract] Content extracted:", result.result.length, "chars");
        sendResponse({ 
          success: true, 
          content: result.result, 
          url: tab.url 
        });
      } catch (error) {
        console.error("[SmartShare:Extract] Failed:", error);
        sendResponse({ success: false, error: error.message });
      }
    });
    return true; // Required for async sendResponse
  }

  // 🗑️ COMMENTED OUT - Future feature for context menu
  // if (msg.action === "summarizeNow" && sender.tab?.id) {
  //   try {
  //     const [result] = await chrome.scripting.executeScript({
  //       target: { tabId: sender.tab.id },
  //       func: extractReadableContentSimple,
  //     });
  //
  //     await chrome.storage.session.set({
  //       pageContent: result.result,
  //       pageUrl: sender.tab.url,
  //     });
  //
  //     await chrome.sidePanel.open({ windowId: sender.tab.windowId });
  //     console.log("[SmartShare] Summarization triggered for:", sender.tab.url);
  //   } catch (err) {
  //     console.error("[SmartShare] Summarization trigger failed:", err);
  //   }
  // }
});