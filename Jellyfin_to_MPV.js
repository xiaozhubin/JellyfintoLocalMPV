// ==UserScript==
// @name         Jellyfin to MPV (v3.4.1 - On-Demand API & Detail List Button)
// @namespace    http://tampermonkey.net/
// @version      3.4.1
// @description  Hijacks card resume/play buttons and adds a button to detail pages to play videos in local MPV player using data-path or API on demand.
// @author       YourName
// @match        *://jellyfinlocalsite/web/* //replace the "jellyfinlocalsite" to your own jellyfin website
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      jellyfinlocalsite
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    // Define critical constants immediately
    const HIJACKED_FLAG = 'data-mpv-hijacked';
    const MPV_BUTTON_CLASS = 'jellyfin-mpv-new-button'; // For newly added buttons on detail pages
    const LS_API_KEY = 'jellyfinMpv_apiKey';
    const LS_USER_ID = 'jellyfinMpv_userId';
    const LS_SERVER_ADDRESS = 'jellyfinMpv_serverAddress';

    console.log("Jellyfin to MPV Userscript (v3.4.1) starting...");

    // --- 用户配置 ---
    const preferLocalPath = true;
    const pathMappings = [
        { serverPrefix: "/server/path/", localPrefix: "\\\\local\\web\\path\\" }, // set the path
        { serverPrefix: "/server/path/", localPrefix: "\\\\local\\web\\path\\" },
        { serverPrefix: "/server/path/", localPrefix: "\\\\local\\web\\path\\" },
    ];

    let scanTimeoutId = null;
    let mutationObserver = null;
    let isScanning = false;

    let userApiKey = localStorage.getItem(LS_API_KEY);
    let userIdForApi = localStorage.getItem(LS_USER_ID);
    let serverAddressForApi = localStorage.getItem(LS_SERVER_ADDRESS) || window.location.origin;

    // --- API Credentials Logic ---

    function getApiCredentials(forcePrompt = false) {
        if (!forcePrompt) {
            userApiKey = localStorage.getItem(LS_API_KEY);
            userIdForApi = localStorage.getItem(LS_USER_ID);
            serverAddressForApi = localStorage.getItem(LS_SERVER_ADDRESS) || window.location.origin;
        }

        if (forcePrompt || !userApiKey || !userIdForApi || !serverAddressForApi) {
            console.log("Jellyfin to MPV: API Key, User ID, or Server Address not found/forced prompt.");

            const inputServerAddress = prompt("Jellyfin to MPV: Enter your Jellyfin Server Address (e.g., http://192.168.1.1:1111):", serverAddressForApi || window.location.origin);
            if (!inputServerAddress) {
                alert("Server address is required for API calls. Action cancelled.");
                return false;
            }
            serverAddressForApi = inputServerAddress.replace(/\/$/, '');
            localStorage.setItem(LS_SERVER_ADDRESS, serverAddressForApi);

            const inputApiKey = prompt("Jellyfin to MPV: Enter your Jellyfin API Key (Dashboard -> API Keys):", userApiKey || "");
            if (!inputApiKey) {
                alert("API Key is required for API calls. Action cancelled.");
                return false;
            }
            userApiKey = inputApiKey;
            localStorage.setItem(LS_API_KEY, userApiKey);

            const inputUserId = prompt("Jellyfin to MPV: Enter your Jellyfin User ID (Dashboard -> Users -> select user -> ID in URL/details):", userIdForApi || "");
            if (!inputUserId) {
                alert("User ID is required for API calls. Action cancelled.");
                return false;
            }
            userIdForApi = inputUserId;
            localStorage.setItem(LS_USER_ID, userIdForApi);

            console.log("Jellyfin to MPV: API credentials stored/updated.");
            return true;
        }
        return true;
    }

    async function getPlaybackInfoFromServer(itemId, serverIdForContext) {
        if (!userApiKey || !userIdForApi || !serverAddressForApi) {
            console.error("Jellyfin to MPV (getPlaybackInfoFromServer): Pre-flight check failed - API credentials missing.");
             if (!getApiCredentials(true)) {
                 alert("API credentials are required to fetch media info. Please try the action again.");
                 return null;
            }
        }
        console.log(`Jellyfin to MPV (getPlaybackInfoFromServer): Fetching info for itemId: ${itemId}`);

        const url = `${serverAddressForApi}/Items/${itemId}/PlaybackInfo?UserId=${userIdForApi}&api_key=${userApiKey}`;
        const headers = {
            "Content-Type": "application/json",
            "X-Emby-Authorization": `MediaBrowser Client="Jellyfin to MPV Script", Device="UserScript", DeviceId="userscript-device-v3.4.1", Version="3.4.1", Token="${userApiKey}"`
        };

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: headers,
                data: JSON.stringify({}),
                timeout: 15000,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.MediaSources && data.MediaSources.length > 0) {
                                const sourceWithPath = data.MediaSources.find(s => s.Path && s.Path.trim() !== '');
                                const chosenSource = sourceWithPath || data.MediaSources[0];
                                console.log("Jellyfin to MPV (getPlaybackInfoFromServer): Path from API:", chosenSource.Path);
                                resolve(chosenSource.Path);
                            } else {
                                console.warn("Jellyfin to MPV (getPlaybackInfoFromServer): No MediaSources found for itemId:", itemId, data);
                                resolve(null);
                            }
                        } catch (e) {
                            console.error("Jellyfin to MPV (getPlaybackInfoFromServer): Error parsing PlaybackInfo response.", e, response.responseText);
                            reject("Error parsing JSON");
                        }
                    } else {
                        console.error(`Jellyfin to MPV (getPlaybackInfoFromServer): Error fetching PlaybackInfo. Status: ${response.status}`, response.responseText);
                        if (response.status === 401 || response.status === 403) {
                            alert("Jellyfin to MPV: API request failed (Unauthorized/Forbidden). Please check your API Key and User ID. You may need to re-enter them.");
                        }
                        reject(`Error fetching PlaybackInfo: ${response.status}`);
                    }
                },
                onerror: function(error) {
                    console.error("Jellyfin to MPV (getPlaybackInfoFromServer): Network error.", error);
                    alert("Jellyfin to MPV: Network error. Check console and ensure server address is correct.");
                    reject("Network error");
                },
                ontimeout: function() {
                    console.error("Jellyfin to MPV (getPlaybackInfoFromServer): Request timed out.");
                    alert("Jellyfin to MPV: API request timed out.");
                    reject("Timeout");
                }
            });
        });
    }

    // --- Button and DOM Logic ---

    function transformToLocalPath(serverPath, mappings) {
        if (!serverPath) return null;
        for (const mapping of mappings) {
            if (serverPath.startsWith(mapping.serverPrefix)) {
                const remainingPath = serverPath.substring(mapping.serverPrefix.length).replace(/\//g, '\\');
                const localPath = mapping.localPrefix.replace(/[/\\]$/, '') + '\\' + remainingPath.replace(/^[/\\]/, '');
                return localPath;
            }
        }
        console.warn(`Jellyfin to MPV: No matching mapping for server path: "${serverPath}"`);
        return null;
    }

    function playWithMpv(localPath, buttonToFeedback) {
        if (!localPath) { console.error("Jellyfin to MPV: playWithMpv called with null localPath."); return; }
        console.log(`Jellyfin to MPV: Attempting to play local path: ${localPath}`);
        const encodedTargetPath = encodeURIComponent(localPath);
        window.location.href = `mpv://${encodedTargetPath}`;

        if (buttonToFeedback && buttonToFeedback.parentNode) {
            const originalHTML = buttonToFeedback.innerHTML;
            const originalTitle = buttonToFeedback.title;
            buttonToFeedback.innerHTML = '<span><i class="md-icon" style="font-family: \'Material Icons\';">check_circle</i> Sent!</span>';
            buttonToFeedback.disabled = true;
            setTimeout(() => {
                if (buttonToFeedback && buttonToFeedback.parentNode) {
                    buttonToFeedback.innerHTML = originalHTML;
                    buttonToFeedback.title = originalTitle;
                    buttonToFeedback.disabled = false;
                }
            }, 2500);
        }
    }

    function createNewMpvButton(serverPathToUse) {
        if (!serverPathToUse) { return null; }
        const localPath = preferLocalPath ? transformToLocalPath(serverPathToUse, pathMappings) : null;
        if (!localPath) { return null; }

        const button = document.createElement('button');
        button.innerHTML = '<span>▷</span> Play with MPV';
        button.className = `button-flat itemExtraButton emby-button ${MPV_BUTTON_CLASS}`;
        button.type = 'button';
        button.setAttribute('title', `Play with MPV: ${localPath}`);
        button.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); playWithMpv(localPath, button); });
        return button;
    }

    function buttonSetLoading(button, isLoading) {
        if (!button || !(button instanceof HTMLElement)) return;
        if (isLoading) {
            if (!button.dataset.originalHtml) {
                button.dataset.originalHtml = button.innerHTML;
                button.dataset.originalTitle = button.title;
            }
            button.innerHTML = '<span><i class="md-icon" style="font-family: \'Material Icons\';">hourglass_empty</i></span>';
            button.disabled = true;
        } else {
            if (button.dataset.originalHtml) {
                button.innerHTML = button.dataset.originalHtml;
                button.title = button.dataset.originalTitle;
                delete button.dataset.originalHtml;
                delete button.dataset.originalTitle;
            }
            button.disabled = false;
        }
    }

    async function handlePlayButtonClick(event, playButton) { // Renamed from handleResumeButtonClick
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        console.log("Jellyfin to MPV (handlePlayButton): Click intercepted for button:", playButton);

        // Find the closest ancestor that has a data-id attribute (could be .card, .listItem, etc.)
        const itemContainerElement = playButton.closest('[data-id]');
        if (!itemContainerElement) {
            console.warn("Jellyfin to MPV (handlePlayButton): Could not find parent element with [data-id] for button:", playButton);
            alert("Jellyfin to MPV: Could not find item information for this button.");
            return;
        }
        console.log("Jellyfin to MPV (handlePlayButton): Found item container:", itemContainerElement);


        let serverPath = itemContainerElement.dataset.path; // Check if data-path is directly on this container
        let localPath = null;

        if (serverPath) {
            console.log("Jellyfin to MPV (handlePlayButton): Found serverPath from element's data-path:", serverPath);
            localPath = transformToLocalPath(serverPath, pathMappings);
        } else {
            console.warn("Jellyfin to MPV (handlePlayButton): data-path NOT found on item container. Attempting API fallback.");
            if (!getApiCredentials()) {
                return;
            }

            const itemId = itemContainerElement.dataset.id;
            const serverId = itemContainerElement.dataset.serverid; // For context

            if (!itemId) {
                console.warn("Jellyfin to MPV (handlePlayButton): Could not find itemId (data-id) on item container for API fallback.", itemContainerElement);
                alert("Jellyfin to MPV: Item ID not found for API call.");
                return;
            }

            buttonSetLoading(playButton, true);
            try {
                serverPath = await getPlaybackInfoFromServer(itemId, serverId);
                if (serverPath) {
                    localPath = transformToLocalPath(serverPath, pathMappings);
                } else {
                    console.warn("Jellyfin to MPV (handlePlayButton): API fallback did not return a server path for item:", itemId);
                }
            } catch (error) {
                console.error("Jellyfin to MPV (handlePlayButton): Error fetching playback info via API:", error);
            } finally {
                buttonSetLoading(playButton, false);
            }
        }

        if (localPath) {
            playWithMpv(localPath, playButton);
        } else {
            alert("Jellyfin to MPV: Could not determine video path for MPV.");
            if (playButton.dataset.originalHtml) buttonSetLoading(playButton, false);
        }
    }

    function hijackPlayButton(playButton) { // Renamed from hijackCardResumeButton
        if (!playButton || !(playButton instanceof HTMLButtonElement) || playButton.hasAttribute(HIJACKED_FLAG)) {
            return;
        }
        // console.log("Jellyfin to MPV: Attaching hijack listener to play button:", playButton);
        playButton.addEventListener('click', (e) => handlePlayButtonClick(e, playButton), true);
        playButton.setAttribute(HIJACKED_FLAG, 'true');
        const originalTitle = playButton.title || 'Play/Resume';
        playButton.title = `Play with MPV (was: ${originalTitle})`;
    }

    async function addMpvButtonToDetailPageContainer(detailContainer) {
        if (!detailContainer || !(detailContainer instanceof HTMLElement) || detailContainer.querySelector(`.${MPV_BUTTON_CLASS}`)) {
            return;
        }
        // console.log("Jellyfin to MPV: Attempting to add button to detail page container:", detailContainer);

        let serverPath = null;
        const itemDetailPageElement = detailContainer.closest('#itemDetailPage');
        let itemId = null;
        let serverId = null;

        if (itemDetailPageElement) {
            itemId = itemDetailPageElement.dataset.id;
            serverId = itemDetailPageElement.dataset.serverid;

            const mainItemElementWithDataPath = itemDetailPageElement.querySelector('.itemDetailImage[data-id][data-path], .itemDetailImageContainer[data-id][data-path], [data-id][data-path].itemPage, .itemBackdrop[data-id][data-path]');
            if (mainItemElementWithDataPath && mainItemElementWithDataPath.dataset.path) {
                serverPath = mainItemElementWithDataPath.dataset.path;
            } else if (itemDetailPageElement.dataset.path) {
                serverPath = itemDetailPageElement.dataset.path;
            }

            if (!serverPath && itemId) {
                console.warn("Jellyfin to MPV (addDetailButton): data-path not found on detail page. Attempting API fallback for item:", itemId);
                if (!getApiCredentials()) {
                    return;
                 }
                detailContainer.dataset.mpvButtonLoading = "true";
                try {
                    serverPath = await getPlaybackInfoFromServer(itemId, serverId);
                } catch (error) { console.error("Jellyfin to MPV (addDetailButton): API error for detail page:", error); }
                delete detailContainer.dataset.mpvButtonLoading;
            }
        } else {
             const parentWithDataPath = detailContainer.closest('[data-path]');
             if (parentWithDataPath && parentWithDataPath.dataset.path) {
                serverPath = parentWithDataPath.dataset.path;
             }
        }

        if (!serverPath) {
            console.warn("Jellyfin to MPV (addDetailButton): Could not determine serverPath for detail page button.");
            return;
        }
        const newButton = createNewMpvButton(serverPath);
        if (newButton) {
            detailContainer.prepend(newButton);
        }
    }

    function processElementsInNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
        // console.log("Jellyfin to MPV (processElements): Processing node:", node.tagName);

        // Selector for card overlay resume buttons
        const cardResumeButtonsSelector = 'button[is="paper-icon-button-light"].cardOverlayButton[data-action="resume"]';
        // Selector for list item image resume buttons (from user input)
        const listItemResumeButtonsSelector = 'button[is="paper-icon-button-light"].listItemImageButton[data-action="resume"]';

        // Process card resume buttons
        if (node.matches && node.matches(cardResumeButtonsSelector)) {
            try { hijackPlayButton(node); } catch (e) { console.error("Jellyfin to MPV: Error hijacking matched card node:", node, e); }
        }
        if (typeof node.querySelectorAll === 'function') {
            node.querySelectorAll(cardResumeButtonsSelector).forEach(btn => {
                try { hijackPlayButton(btn); } catch (e) { console.error("Jellyfin to MPV: Error hijacking queried card node:", btn, e); }
            });
        }

        // Process list item resume buttons
        if (node.matches && node.matches(listItemResumeButtonsSelector)) {
            try { hijackPlayButton(node); } catch (e) { console.error("Jellyfin to MPV: Error hijacking matched list item node:", node, e); }
        }
        if (typeof node.querySelectorAll === 'function') {
            node.querySelectorAll(listItemResumeButtonsSelector).forEach(btn => {
                try { hijackPlayButton(btn); } catch (e) { console.error("Jellyfin to MPV: Error hijacking queried list item node:", btn, e); }
            });
        }

        // Process detail page button containers
        const detailContainerSelector = 'div.mainDetailButtons.focuscontainer-x';
        if (node.matches && node.matches(detailContainerSelector)) {
            try { addMpvButtonToDetailPageContainer(node); } catch (e) { console.error("Jellyfin to MPV: Error adding button to matched detail container:", node, e); }
        }
        if (typeof node.querySelectorAll === 'function') {
            node.querySelectorAll(detailContainerSelector).forEach(container => {
                try { addMpvButtonToDetailPageContainer(container); } catch (e) { console.error("Jellyfin to MPV: Error adding button to queried detail container:", container, e); }
            });
        }
    }

    function addPageStyles() {
        const styleId = 'jellyfin-mpv-userscript-styles';
        if (document.getElementById(styleId)) return;
        GM_addStyle(`
            .${MPV_BUTTON_CLASS} {
                margin-left: 0px !important; margin-right: 8px !important;
                background-color: #00a4dc !important; color: white !important;
                order: -1; padding: 0.5em 0.75em !important;
                min-width: auto !important; line-height: normal !important;
                font-size: var(--font-size-button, 0.8125rem);
                border-radius: var(--button-border-radius, 4px);
            }
            .${MPV_BUTTON_CLASS}:hover { background-color: #0087b3 !important; opacity: 1 !important; }
            .${MPV_BUTTON_CLASS} span { margin-right: 6px; }
            button[${HIJACKED_FLAG}="true"] .cardOverlayButtonIcon,
            button[${HIJACKED_FLAG}="true"] .listItemImageButton-icon { /* Style for hijacked icons */
                /* color: #00a4dc !important; */ /* Example: Make hijacked icons blue */
                /* font-weight: bold !important; */
            }
        `);
        const marker = document.createElement('meta');
        marker.id = styleId;
        (document.head || document.documentElement).appendChild(marker);
    }

    function scanDomForTargets() {
        if (isScanning) return;
        isScanning = true;
        try {
            processElementsInNode(document.body);
        } catch (e) { console.error("Jellyfin to MPV: Error during full DOM scan:", e); }
        isScanning = false;
    }

    function initializeObserverAndScan() {
        if (mutationObserver) mutationObserver.disconnect();
        mutationObserver = new MutationObserver((mutationsList) => {
            if (isScanning) return;
            isScanning = true;
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        try { processElementsInNode(node); }
                        catch (e) { console.error("Jellyfin to MPV: Error processing added node in MutationObserver:", node, e); }
                    });
                }
            }
            isScanning = false;
        });
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        requestAnimationFrame(() => scanDomForTargets());
    }

    function mainApplicationStart() {
        console.log("Jellyfin to MPV (v3.4.1): mainApplicationStart called.");
        addPageStyles();
        getApiCredentials(); // Load stored credentials or prompt if first time and API fallback is needed later

        window.addEventListener('hashchange', () => {
            clearTimeout(scanTimeoutId);
            scanTimeoutId = setTimeout(() => {
                requestAnimationFrame(() => scanDomForTargets());
            }, 750);
        });
        initializeObserverAndScan();
    }

    const initialPageLoadDelay = 2000;
    if (document.readyState === 'complete') {
        setTimeout(mainApplicationStart, initialPageLoadDelay);
    } else {
        window.addEventListener('load', () => {
            setTimeout(mainApplicationStart, initialPageLoadDelay);
        }, { once: true });
    }
})();
