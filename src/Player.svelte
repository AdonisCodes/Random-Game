<script>
    import { createEventDispatcher } from "svelte";
    const dispatchEvent = createEventDispatcher()
    export let score;
    export let winning;
    export let won;
    export let team;
    export let gameOver;

    function plus() {
        dispatchEvent('points', +1)
    }
</script>

<div style="color:{team};" class="player">

    <button on:click={plus} disabled={gameOver} class="plus">+</button>
    <p>{score}: </p>
    {#if won}
    <p>{winning}</p>
    {/if}
</div>

<style>
    button[disabled] {
        background-color: gray;
        pointer-events: none;
    }

    .player {
        flex-grow: 1;
        display: flex;
    }
    .plus {
        background-color: green;
    }

    button {
        margin: 5px 5px;
        font-size: 20px;
        border-radius: 3px;
        width: 40px;
        height: 40px;
        color: white;
        font-family: monospace;
        font-weight: bold;
        border: none;

    }
</style>
