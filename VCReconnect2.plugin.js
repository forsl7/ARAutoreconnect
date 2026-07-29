/**
 * @name VCAutoReconnect
 * @author AR
 * @description Lock button under mute controls + reliable auto-reconnect
 * @version 0.1
 */

const { Webpack, Webpack: { Filters, getStore, getByKeys, getModule }, UI, Data, DOM } = BdApi;

module.exports = class VCAutoReconnect {
    constructor(meta) {
        this.meta = meta;
        this.enabled = false;
        this.targetChannelId = null;
        this.rejoinCount = 0;
        this.checkInterval = null;
        this.buttonInterval = null;
        this.selectVoiceChannel = null;
        this.isReconnecting = false;
    }

    start() {
        console.log("[VCAutoReconnect] v5.2 starting...");
        this.load();

        this.VoiceStateStore = getStore("VoiceStateStore");
        this.UserStore = getStore("UserStore");
        this.ChannelStore = getStore("ChannelStore");
        this.SelectedChannelStore = getStore("SelectedChannelStore");

        // Strong search for the join function
        this.selectVoiceChannel =
            getByKeys("selectVoiceChannel")?.selectVoiceChannel ||
            getModule(m => typeof m?.selectVoiceChannel === "function")?.selectVoiceChannel ||
            getModule(Filters.byKeys("selectChannel"))?.selectVoiceChannel ||
            getModule(Filters.byKeys("selectChannel", "selectTextChannel"))?.selectVoiceChannel ||
            getModule(m => m?.selectVoiceChannel && m?.selectChannel)?.selectVoiceChannel;

        if (!this.selectVoiceChannel) {
            UI.showToast("Join function still missing – reconnect may not work", { type: "error" });
            console.error("[VCAutoReconnect] selectVoiceChannel NOT FOUND");
        } else {
            console.log("[VCAutoReconnect] selectVoiceChannel OK");
        }

        DOM.addStyle(this.meta.name, `
            #vc-big-lock {
                display: block !important;
                width: calc(100% - 16px) !important;
                margin: 8px 8px 4px 8px !important;
                padding: 10px 0 !important;
                border-radius: 4px !important;
                border: none !important;
                font-size: 13px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                text-align: center !important;
                z-index: 99999 !important;
            }
            #vc-big-lock.locked {
                background: #5865f2 !important;
                color: white !important;
            }
            #vc-big-lock.unlocked {
                background: #4e5058 !important;
                color: #fff !important;
            }
            #vc-big-lock:hover {
                filter: brightness(1.15) !important;
            }
        `);

        this.startChecker();
        this.forceButton();
        this.buttonInterval = setInterval(() => this.forceButton(), 1000);

        UI.showToast("VCAutoReconnect ready", { type: "success" });
    }

    stop() {
        this.stopChecker();
        if (this.buttonInterval) clearInterval(this.buttonInterval);
        DOM.removeStyle(this.meta.name);
        const btn = document.getElementById("vc-big-lock");
        if (btn) btn.remove();
    }

    load() {
        const d = Data.load(this.meta.name, "data") || {};
        this.enabled = !!d.enabled;
        this.targetChannelId = d.targetChannelId || null;
        this.rejoinCount = d.rejoinCount || 0;
    }

    save() {
        Data.save(this.meta.name, "data", {
            enabled: this.enabled,
            targetChannelId: this.targetChannelId,
            rejoinCount: this.rejoinCount
        });
    }

    forceButton() {
        let btn = document.getElementById("vc-big-lock");

        const panel = document.querySelector('section[aria-label="User area"]') ||
                      document.querySelector('[class*="panels"]');

        if (!panel) return;

        if (!btn) {
            btn = document.createElement("button");
            btn.id = "vc-big-lock";
            btn.onclick = () => {
                const id = this.getCurrentVoiceId();
                if (!id && !this.targetChannelId) {
                    UI.showToast("Join a voice channel first!", { type: "warning" });
                    return;
                }
                // If already locked, unlock. Otherwise lock current (or keep previous)
                this.toggle(id || this.targetChannelId);
            };
            panel.appendChild(btn);
        }

        const isLocked = this.enabled && this.targetChannelId;
        btn.className = isLocked ? "locked" : "unlocked";
        btn.innerText = isLocked
            ? `🔒 LOCKED (${this.rejoinCount}) – Click to unlock`
            : "🔓 LOCK CURRENT VC";
    }

    toggle(channelId) {
        if (this.enabled && this.targetChannelId === channelId) {
            this.enabled = false;
            this.targetChannelId = null;
            UI.showToast("Unlocked", { type: "info" });
        } else {
            this.enabled = true;
            this.targetChannelId = channelId;
            this.rejoinCount = 0;
            const name = this.ChannelStore.getChannel(channelId)?.name || "VC";
            UI.showToast("Locked to: " + name, { type: "success" });
        }
        this.save();
        this.startChecker();
        this.forceButton();
    }

    getCurrentVoiceId() {
        try {
            if (this.SelectedChannelStore?.getVoiceChannelId) {
                return this.SelectedChannelStore.getVoiceChannelId();
            }
            const me = this.UserStore.getCurrentUser();
            return this.VoiceStateStore.getVoiceStateForUser(me.id)?.channelId || null;
        } catch (e) {
            return null;
        }
    }

    startChecker() {
        this.stopChecker();
        if (!this.enabled || !this.targetChannelId) return;

        console.log("[VCAutoReconnect] Checker started for channel", this.targetChannelId);

        this.checkInterval = setInterval(() => {
            if (this.isReconnecting) return;

            const current = this.getCurrentVoiceId();

            if (current === this.targetChannelId) return; // already in

            // We are disconnected → reconnect
            console.log("[VCAutoReconnect] Disconnected! Trying to rejoin...");
            this.isReconnecting = true;

            try {
                if (this.selectVoiceChannel) {
                    this.selectVoiceChannel(this.targetChannelId);
                } else {
                    // Fallback: try clicking the channel in the list
                    const el = document.querySelector(`[data-list-item-id="channels___${this.targetChannelId}"]`);
                    if (el) el.click();
                }

                this.rejoinCount++;
                this.save();
                this.forceButton();
                UI.showToast(`Reconnecting... (#${this.rejoinCount})`, { type: "info" });
            } catch (e) {
                console.error("[VCAutoReconnect] Rejoin failed:", e);
            }

            // Prevent spam
            setTimeout(() => {
                this.isReconnecting = false;
            }, 3000);
        }, 2000); // check every 2 seconds
    }

    stopChecker() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    getSettingsPanel() {
        const div = document.createElement("div");
        div.style.padding = "16px";
        div.innerHTML = `
            <h3>VC Auto-Reconnect</h3>
            <p>Lock the VC with the big button under mute controls.</p>
            <p style="opacity:0.7">
                Target: <code>${this.targetChannelId || "none"}</code><br>
                Join function: <b>${this.selectVoiceChannel ? "OK" : "MISSING"}</b>
            </p>
        `;
        return div;
    }
};
