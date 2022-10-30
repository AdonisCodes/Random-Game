var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        if (value === null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
     * Event dispatchers are functions that can take two arguments: `name` and `detail`.
     *
     * Component events created with `createEventDispatcher` create a
     * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
     * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
     * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
     * property and can contain any type of data.
     *
     * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
     */
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src\Player.svelte generated by Svelte v3.52.0 */

    function create_if_block(ctx) {
    	let p;
    	let t;

    	return {
    		c() {
    			p = element("p");
    			t = text(/*winning*/ ctx[1]);
    		},
    		m(target, anchor) {
    			insert(target, p, anchor);
    			append(p, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*winning*/ 2) set_data(t, /*winning*/ ctx[1]);
    		},
    		d(detaching) {
    			if (detaching) detach(p);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let div;
    	let button;
    	let t0;
    	let t1;
    	let p;
    	let t2;
    	let t3;
    	let t4;
    	let mounted;
    	let dispose;
    	let if_block = /*won*/ ctx[2] && create_if_block(ctx);

    	return {
    		c() {
    			div = element("div");
    			button = element("button");
    			t0 = text("+");
    			t1 = space();
    			p = element("p");
    			t2 = text(/*score*/ ctx[0]);
    			t3 = text(":");
    			t4 = space();
    			if (if_block) if_block.c();
    			button.disabled = /*gameOver*/ ctx[4];
    			attr(button, "class", "plus svelte-1dj0z6w");
    			set_style(div, "color", /*team*/ ctx[3]);
    			attr(div, "class", "player svelte-1dj0z6w");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, button);
    			append(button, t0);
    			append(div, t1);
    			append(div, p);
    			append(p, t2);
    			append(p, t3);
    			append(div, t4);
    			if (if_block) if_block.m(div, null);

    			if (!mounted) {
    				dispose = listen(button, "click", /*plus*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*gameOver*/ 16) {
    				button.disabled = /*gameOver*/ ctx[4];
    			}

    			if (dirty & /*score*/ 1) set_data(t2, /*score*/ ctx[0]);

    			if (/*won*/ ctx[2]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*team*/ 8) {
    				set_style(div, "color", /*team*/ ctx[3]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	const dispatchEvent = createEventDispatcher();
    	let { score } = $$props;
    	let { winning } = $$props;
    	let { won } = $$props;
    	let { team } = $$props;
    	let { gameOver } = $$props;

    	function plus() {
    		dispatchEvent('points', +1);
    	}

    	$$self.$$set = $$props => {
    		if ('score' in $$props) $$invalidate(0, score = $$props.score);
    		if ('winning' in $$props) $$invalidate(1, winning = $$props.winning);
    		if ('won' in $$props) $$invalidate(2, won = $$props.won);
    		if ('team' in $$props) $$invalidate(3, team = $$props.team);
    		if ('gameOver' in $$props) $$invalidate(4, gameOver = $$props.gameOver);
    	};

    	return [score, winning, won, team, gameOver, plus];
    }

    class Player extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {
    			score: 0,
    			winning: 1,
    			won: 2,
    			team: 3,
    			gameOver: 4
    		});
    	}
    }

    /* src\App.svelte generated by Svelte v3.52.0 */

    function create_fragment(ctx) {
    	let main;
    	let p;
    	let t1;
    	let div;
    	let player0;
    	let t2;
    	let player1;
    	let t3;
    	let button;
    	let current;
    	let mounted;
    	let dispose;

    	player0 = new Player({
    			props: {
    				gameOver: /*gameOver*/ ctx[4],
    				team: 'blue',
    				won: /*blueWon*/ ctx[2],
    				winning: 'blue wins',
    				score: /*blueScore*/ ctx[1]
    			}
    		});

    	player0.$on("points", /*updateBlueScore*/ ctx[6]);

    	player1 = new Player({
    			props: {
    				gameOver: /*gameOver*/ ctx[4],
    				team: 'red',
    				won: /*redWon*/ ctx[3],
    				winning: 'Red wins',
    				score: /*redScore*/ ctx[0]
    			}
    		});

    	player1.$on("points", /*updateRedScore*/ ctx[7]);

    	return {
    		c() {
    			main = element("main");
    			p = element("p");
    			p.textContent = "Magic The Gatherer Counter";
    			t1 = space();
    			div = element("div");
    			create_component(player0.$$.fragment);
    			t2 = space();
    			create_component(player1.$$.fragment);
    			t3 = space();
    			button = element("button");
    			button.textContent = "Start Game";
    			attr(div, "id", "controls-container");
    			attr(div, "class", "svelte-1cl3lnq");
    			attr(button, "class", "svelte-1cl3lnq");
    			attr(main, "class", "svelte-1cl3lnq");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, p);
    			append(main, t1);
    			append(main, div);
    			mount_component(player0, div, null);
    			append(div, t2);
    			mount_component(player1, div, null);
    			append(main, t3);
    			append(main, button);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*reset*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			const player0_changes = {};
    			if (dirty & /*gameOver*/ 16) player0_changes.gameOver = /*gameOver*/ ctx[4];
    			if (dirty & /*blueWon*/ 4) player0_changes.won = /*blueWon*/ ctx[2];
    			if (dirty & /*blueScore*/ 2) player0_changes.score = /*blueScore*/ ctx[1];
    			player0.$set(player0_changes);
    			const player1_changes = {};
    			if (dirty & /*gameOver*/ 16) player1_changes.gameOver = /*gameOver*/ ctx[4];
    			if (dirty & /*redWon*/ 8) player1_changes.won = /*redWon*/ ctx[3];
    			if (dirty & /*redScore*/ 1) player1_changes.score = /*redScore*/ ctx[0];
    			player1.$set(player1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(player0.$$.fragment, local);
    			transition_in(player1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(player0.$$.fragment, local);
    			transition_out(player1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(player0);
    			destroy_component(player1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let blueWon;
    	let redWon;
    	let gameOver;
    	let redScore = 20;
    	let blueScore = 20;

    	function reset() {
    		$$invalidate(1, blueScore = 20);
    		$$invalidate(0, redScore = 20);
    	}

    	function updateBlueScore(e) {
    		$$invalidate(1, blueScore += e.detail);
    		$$invalidate(0, redScore--, redScore);
    	}

    	function updateRedScore(e) {
    		$$invalidate(0, redScore += e.detail);
    		$$invalidate(1, blueScore--, blueScore);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*redScore*/ 1) {
    			$$invalidate(2, blueWon = redScore <= 0);
    		}

    		if ($$self.$$.dirty & /*blueScore*/ 2) {
    			$$invalidate(3, redWon = blueScore <= 0);
    		}

    		if ($$self.$$.dirty & /*redWon, blueWon*/ 12) {
    			$$invalidate(4, gameOver = redWon || blueWon);
    		}
    	};

    	return [
    		redScore,
    		blueScore,
    		blueWon,
    		redWon,
    		gameOver,
    		reset,
    		updateBlueScore,
    		updateRedScore
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
