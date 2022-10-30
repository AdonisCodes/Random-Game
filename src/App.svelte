<script>
    import Player from "./Player.svelte";
	let redScore = 20;
	let blueScore = 20;
	$: blueWon = redScore <= 0;
	$: redWon = blueScore <= 0;
	$: gameOver = redWon || blueWon;
	
	function reset() {
		blueScore = 20
		redScore = 20
	}

	function updateBlueScore(e) {
		blueScore += e.detail
		redScore--
	}
	
	function updateRedScore(e) {
		redScore += e.detail
		blueScore--
	}
</script>

<main>
	<p>Magic The Gatherer Counter</p>
	<div id="controls-container">
		<Player on:points={updateBlueScore} {gameOver} team={'blue'} won={blueWon} winning={'blue wins'} score={blueScore}/>
		<Player on:points={updateRedScore} {gameOver} team={'red'} won={redWon} winning={'Red wins'}  score={redScore}/>
	</div>
	<button on:click={reset}>Start Game</button>
</main>

<style>
	main {
		width: 80%;
		padding: 20px;
		border: solid gray 1px;
		margin: 0 auto;
		background-color: wheat;
		margin: 10vh auto;
	}
	#controls-container {
		display: flex;
	}
	button {
		display: block;
		width: 100%;
		margin-top: 20px;
		border: solid salmon 1px;
		color: rgb(61, 56, 56);
		border-radius: 3px;
		background-color: salmon;
	}
</style>