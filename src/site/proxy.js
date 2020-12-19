/* global sauce */

sauce.ns('proxy', function() {
    'use strict';


    async function ga(...args) {
        return await sauce._ga(document.referrer, ...args);
    }


    async function reportEvent(eventCategory, eventAction, eventLabel, options) {
        await ga('send', 'event', Object.assign({
            eventCategory,
            eventAction,
            eventLabel,
        }, options));
    }


    async function reportError(e) {
        if (e && e.disableReport) {
            console.warn('Ignoring non-reporting error:', e);
            return;
        }
        const page = location.pathname;
        const desc = [`v${sauce && sauce.version}`];
        try {
            if (e == null || !e.stack) {
                console.error("Non-exception object was thrown:", e);
                const props = {type: typeof e};
                try {
                    props.json = JSON.parse(JSON.stringify(e));
                } catch(_) {/*no-pragma*/}
                if (e != null) {
                    props.klass = e.constructor && e.constructor.name;
                    props.name = e.name;
                    props.message = e.message;
                    props.code = e.code;
                }
                desc.push(`Invalid Error: ${JSON.stringify(props)}`);
                for (const x of _stackFrameAudits) {
                    desc.push(` Audit frame: ${x}`);
                }
            } else {
                desc.push(e.stack);
            }
        } catch(intError) {
            desc.push(`Internal error during report error: ${intError.stack} ::: ${e}`);
        }
        for (const x of getStackFrames().slice(1)) {
            desc.push(` Stack frame: ${x}`);
        }
        const exDescription = desc.join('\n');
        console.error('Reporting:', exDescription);
        await ga('send', 'exception', {
            exDescription,
            exFatal: true,
            page
        });
        await reportEvent('Error', 'exception', desc, {nonInteraction: true, page});
    }


    function getStackFrames() {
        const e = new Error();
        return e.stack.split(/\n/).slice(2).map(x => x.trim());
    }


    let _stackFrameAudits = [];
    function auditStackFrame() {
        const frames = getStackFrames();
        const caller = frames && frames[1];
        if (typeof caller === 'string') { // be paranoid for now
            _stackFrameAudits.push(caller);
        }
    }


    async function getLocaleMessage() {
        const data = Array.from(arguments);
        return await invoke({system: 'locale', op: 'getMessage', data});
    }


    async function getLocaleMessages(data) {
        return await invoke({system: 'locale', op: 'getMessages', data});
    }


    async function ping(...data) {
        return await invoke({system: 'util', op: 'ping', data});
    }


    async function bgping(...data) {
        return await invoke({system: 'util', op: 'bgping', data});
    }


    async function openOptionsPage() {
        return await invoke({system: 'options', op: 'openOptionsPage'});
    }


    async function trailforksIntersections() {
        const args = Array.from(arguments);
        return await invoke({system: 'trailforks', op: 'intersections', data: {args}});
    }


    async function histSelfActivities() {
        const args = Array.from(arguments);
        return await invoke({system: 'hist', op: 'selfActivities', data: {args}});
    }


    async function histPeerActivities() {
        const args = Array.from(arguments);
        return await invoke({system: 'hist', op: 'peerActivities', data: {args}});
    }


    async function histFindPeerPeaks() {
        const args = Array.from(arguments);
        return await invoke({system: 'hist', op: 'findPeerPeaks', data: {args}});
    }


    async function histFindSelfPeaks() {
        const args = Array.from(arguments);
        return await invoke({system: 'hist', op: 'findSelfPeaks', data: {args}});
    }


    async function histSyncSelfStreams() {
        const args = Array.from(arguments);
        return await invoke({system: 'hist', op: 'syncSelfStreams', data: {args}});
    }


    async function histSyncPeerStreams() {
        const args = Array.from(arguments);
        return await invoke({system: 'hist', op: 'syncPeerStreams', data: {args}});
    }


    function setupExports(exports) {
        for (const desc of exports) {
            const path = desc.call.split('.');
            let offt = sauce;
            for (const x of path.slice(0, -1)) {
                offt[x] = offt[x] || {};
                offt = offt[x];
            }
            offt[path[path.length - 1]] = (...args) => invoke(desc.call, ...args);
        }
    }


    const _invokePromise = (async () => {
        // Instead of just broadcasting everything over generic 'message' events, create a channel
        // which is like a unix pipe pair and transfer one of the ports to the ext for us
        // to securely and performantly talk over.
        const callbacks = new Map();
        const reqChannel = new MessageChannel();
        const reqPort = reqChannel.port1;
        await new Promise((resolve, reject) => {
            function onMessageEstablishChannelAck(ev) {
                reqPort.removeEventListener('message', onMessageEstablishChannelAck);
                if (!ev.data || ev.data.extId !== sauce.extId ||
                    ev.data.type !== 'sauce-proxy-establish-channel-ack') {
                    reject(new Error('Proxy Protocol Violation [CONTENT] [ACK]!'));
                    return;
                }
                setupExports(ev.data.exports);
                const respPort = ev.ports[0];
                respPort.addEventListener('message', ev => {
                    if (!ev.data || ev.data.extId !== sauce.extId || ev.data.type !== 'sauce-proxy-response') {
                        throw new Error('Proxy Protocol Violation [CONTENT] [RESP]!');
                    }
                    if (ev.data.success === true) {
                        const pid = ev.data.pid;
                        const {resolve} = callbacks.get(pid);
                        callbacks.delete(pid);
                        resolve(ev.data.result);
                    } else if (ev.data.success === false) {
                        const pid = ev.data.pid;
                        const {reject} = callbacks.get(pid);
                        callbacks.delete(pid);
                        reject(new Error(ev.data.result || 'unknown proxy error'));
                    } else {
                        throw new TypeError("Proxy Protocol Violation [DATA]");
                    }
                });
                respPort.start();
                resolve();
            }
            reqPort.addEventListener('message', onMessageEstablishChannelAck);
            reqPort.addEventListener('messageerror', ev => console.error('Message Error:', ev));
            reqPort.start();
            window.postMessage({
                type: 'sauce-proxy-establish-channel',
                extId: sauce.extId,
            }, self.origin, [reqChannel.port2]);
        });
        let proxyId = 0;
        return (call, ...args) => {
            return new Promise((resolve, reject) => {
                const pid = proxyId++;
                callbacks.set(pid, {resolve, reject});
                reqPort.postMessage({
                    pid,
                    call,
                    args,
                    type: 'sauce-proxy-request',
                    extId: sauce.extId
                });
            });
        };
    })();

    let invoke = async (...args) => {
        invoke = await _invokePromise;
        return await invoke(...args);
    };

    return {
        reportEvent,
        reportError,
        auditStackFrame,
        getLocaleMessage,
        getLocaleMessages,
        ping,
        bgping,
        openOptionsPage,
        trailforksIntersections,
        histSelfActivities,
        histPeerActivities,
        histFindPeerPeaks,
        histFindSelfPeaks,
        histSyncPeerStreams,
        histSyncSelfStreams,
    };
});