// Nagios -- Hawkeye
(function (doc, undefined) {

if (doc !== undefined) {
    // Wake the hawk when ready
    doc.addEventListener("DOMContentLoaded", function () {
        nagios_hawk(doc);
    });

    // Export only nagios_hawk for debugging and manual start
    doc.nagios_hawk = nagios_hawk;
}

// Some logging helpers
function log (message) {
    doc !== undefined && !doc.quiet && console.log(message);
}

function logGroup (title, messages) {
    if (doc !== undefined && !doc.quiet) {
        console.group(title);
        messages.forEach(log);
        console.groupEnd();
    }
}


/**
 * Actual nagios hawkeye creation and configuration.
 * 
 * If no `document` is provided then tries with the one present
 * at script loading time.
 * 
 * This function will:
 *  - create and configure the signals
 *  - select and start listening for main iframe reloads
 *  - wake and make attack or rest the hawk when necessary
 * 
 * Verbs:
 *  - Wake: check whether the hawk should attack (is birdseye page?)
 *  - Attack: start listening and signaling events
 *  - Rest: stop listening and wait to wake the hawk again
 * 
 * @param {Document} document
 * 
 * @return The nagios_hawk's controls.
 */
function nagios_hawk (document) {
    log("Hawk: start");
    let observer;

    if (document === undefined) {
        document = doc;
    }

    // Find main iframe and add the listener
    const frame = document.getElementById("maincontentframe");

    frame.addEventListener("load", wake);

    // Start if the iframe is reloaded and is a birdseye page
    function wake () {
        log("Hawk: wake")
        if (is_birdseye()) {
            attack();
        } else {
            rest();
        }
    }

    function is_birdseye () {
        const frame_doc = frame.contentDocument;
        let result = frame_doc.URL.endsWith("/components/birdseye/birdseye.php");
        log("Hawk: is birdseye an iframe? " + (result ? "yes" : "no"));
        return result;
    }

    // Create the blinker and audio signals
    let sos = BlinkerSignal(
        "sos-on", "sos-off", 250,
        "  - - -   ---   ---   ---   - - -  "
    );

    let alarm = AudioSignal(
        ("https://raw.githubusercontent.com/geusebi/hawkeye/master/bell.mp3"),
        30000
    );

    let signal = ComposeSignal([sos, alarm]);

    /**
     * Since everything regarding the birdseye lies in an iframe,
     * every event listener should be added or removed accordingly
     * whenever the iframe content is relodaded.
     */
    function attack () {
        log("Hawk: attack");
        const frame_doc = frame.contentDocument;

        // Add style to the iframe's head element
        const classes = (
            ".sos-on { background-color: gray; } " +
            ".sos-off { } "
        );
        inject_style(frame_doc, classes);

        const source = frame_doc.getElementById("be-hosts");
        const targets = [frame_doc.getElementById("be-dash")];
        logGroup("Hawk: source and targets", [source, targets]);

        observer = Hawkeye(source, targets, signal);
        observer.connect();
    }

    function rest () {
        log("Hawk: rest");
        if (observer !== undefined) {
            observer.disconnect();
        }
    }

    return Object.freeze({attack, rest, wake});
}


/**
 * Append a `style` element to the `head` of the given document.
 * 
 * @param {string} style_str The text content of the new `style` element.
 * @return nothing.
*/
function inject_style (doc, style_str) {
    const style = doc.createElement('style');
    style.textContent = style_str;
    doc.head.append(style);
}


/**
 * Observe and handle events for `source` and `targets` elements.
 * 
 *  - If an element is added or removed from `source` the signal is
 *    started.
 * 
 *  - If the `source` or a target element is clicked the signal is
 *    stopped. 
 * 
 * Note: disconnect if the object is no longer needed.
 * 
 * Returns an object with two methods:
 *  - connect:      start listening
 *  - disconnect:   stop listening
 * 
 * @param {Element} source      Element to watch
 * @param {Element[]} targets   Signal's target elements 
 * @param {Signal} signal       The actual signal
 */
function Hawkeye (source, targets, signal) {
    log("Hawk: looking");
    const observer = new MutationObserver(
        ignore_too_early_call(signal.start, 3000)
    );

    function connect () {
        log("Hawk: start observing");
        observer.observe(source, {childList: true});

        source.addEventListener("click", signal.stop);

        targets.forEach(function(elem) {
            signal.add(elem);
            elem.addEventListener("click", signal.stop);
        });
    }

    function disconnect () {
        log("Hawk: stop observing");
        observer.disconnect();
        
        source.removeEventListener("click", signal.stop);
        
        targets.forEach(function(elem) {
            elem.removeEventListener("click", signal.stop);
        });

        signal.stop();
        signal.empty();
    }

    function ignore_too_early_call (fnct, delta) {
        let first = true;
        let early = true;
        let mark = Date.now();
        return function () {
            if (Date.now() - mark <= delta) {
                log("Hawk: drop too early first change event");
                early = true;
            }
            if (!early || !first) {
                fnct();
            }
            first = false;
        };
    }

    return Object.freeze({connect, disconnect});
}


/**
 * Base class for signals.
 * 
 * Not intended to be used directly.
 * Implements common parts for all other sos.
 */
function Signal () {
    let targets = new Array();

    function add (element) {
        targets.push(element);
    }

    function empty (element) {
        targets.splice(0, targets.length);
    }

    return Object.freeze({add, empty, targets});
}


/**
 * Compose one or more signal into one.
 * 
 * Return a composed signal compatible with the `Signal` interface.
 * 
 * @param {Signal[]} signals
 * 
 * @return The signal's controls. 
 */
function ComposeSignal (signals) {
    function start () {
        signals.forEach(function (signal) {
            signal.start();
        });
    }

    function stop () {
        signals.forEach(function (signal) {
            signal.stop();
        });
    }

    function add (element) {
        signals.forEach(function (signal) {
            signal.add(element);
        });
    }

    function empty () {
        signals.forEach(function (signal) {
            signal.empty();
        });
    }

    return Object.freeze({start, stop, add, empty});
}


/**
 * Create an audio signal.
 * 
 * @extends Signal
 * 
 * `uri` is an URI used to load a valid audio resource (e.g. MP3).
 * `time` defines how many milliseconds to wait between beats.
 * 
 * The created alarm is returned as an object with three methods.
 * `start` and `stop` to control the alarm and `add` to add target
 * elements (useless in this case).
 * 
 * ```
 * // This signal plays an alarm every 10 seconds.
 * let URI = ... some MP3 URL ...;
 * let alarm = AudioSignal(URI, 10000);;
 * alarm.start();
 * ```
 * 
 * @param {string} uri  A valid URI of an audio resource.
 * @param {int} time Time beat.
 * 
 * @return The alarm's controls.
 */
function AudioSignal (uri, time) {
    let {add, empty} = Signal();
    let timer = undefined;
    let audio = new Audio(uri);

    function start () {
        if (timer === undefined) {
            log("Hawk: start alarm");
            audio.play();
            timer = setInterval(function() { audio.play(); }, time);
        }
    }

    function stop () {
        if (timer !== undefined) {
            log("Hawk: stop alarm");
            clearInterval(timer);
            timer = undefined;
        }
    }

    return Object.freeze({start, stop, add, empty});
}


/**
 * Create a blinker based on `pattern`.
 * 
 * @extends Signal
 * 
 * `time` defines how many milliseconds to wait between beats.
 * `on` and `off` are the classes to add to the targets.
 * `pattern` is a sequence of dashes and spaces (space=on, dash=off).
 * 
 * The created blinker is returned as an object with three methods.
 * `start` and `stop` to control the blinker and `add` to add target
 * elements.
 * 
 * Note: when stopped the state corresponds to the first character of
 * pattern.
 * 
 * ```
 * // This blinker adds alternatively the classes `red` and `green`
 * // with a time beat of one second.
 * let blinker = blink_sos("red", "green", 1000, " -");
 * blinker.add(document.getElementById("#target"));
 * blinker.start();
 * ```
 * 
 * @param {string} on       On state class.
 * @param {string} off      Off state class.
 * @param {int} time     Time beat.
 * @param {string} pattern  The blinking pattern to follow.
 * 
 * @return The blinker's controls.
 */
function BlinkerSignal (on, off, time, pattern) {
    let {add, empty, targets} = Signal();
    let timer = undefined;
    let i;

    stop();

    function start () {
        if (timer === undefined) {
            log("Hawk: start blinker");
            timer = setInterval(update, time);
        }
    }

    function stop () {
        if (timer !== undefined) {
            log("Hawk: stop blinker");
            clearInterval(timer);
            timer = undefined;
        }
        i = 0;
        update();
    }

    function update () {
        targets.forEach(function(elem) {
            if (pattern[i] == "-") {
                elem.classList.remove(off);
                elem.classList.add(on);
            } else {
                elem.classList.remove(on);
                elem.classList.add(off);
            }
        });
        i = (i + 1) % pattern.length;
    }

    return Object.freeze({start, stop, add, empty});
}

// Finis

})(document, undefined);


/* Manual start in verbose mode
document.quiet = false;
document.nagios_hawk().wake();
 */
