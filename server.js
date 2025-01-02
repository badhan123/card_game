const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// Create an express app and an HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the "public" directory
app.use(express.static('public'));

// Serve the "card_images" folder for the card images
app.use('/card_images', express.static('card_images'));

// Game state
let players = [];
let gameState = {
    players: [],
    currentPlayer: 0, // Start with Player 1
    currentDiscard: [],
    deck: [],
    selectedCards: [],
    gameOver: false,
    gameStarted: false,
};

// Generate a shuffled deck
function generateDeck() {
    const suits = ["Spades", "Diamonds", "Hearts", "Clubs"];
    const deck = [];
    for (let suit of suits) {
        for (let value = 1; value <= 10; value++) {
            deck.push({ suit, value });
        }
    }
    return shuffle(deck);
}

// Shuffle function
function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Initialize players
function initializePlayers() {
    players.forEach(player => {
        player.hand = gameState.deck.splice(0, 7); // Deal 7 cards
        player.score = 0; // Initialize score
    });
    gameState.gameStarted = true;
    io.emit('gameStarted', gameState);
}

// Start the game once enough players are connected
function startGame() {
    gameState.deck = generateDeck();
    initializePlayers();
    io.emit('gameUpdate', gameState);
}


function resetHandsAndDeck() {
    gameState.players.forEach(player => {
        player.hand = [];
    });

    gameState.deck = generateDeck(); // Generate and shuffle the deck

    gameState.players.forEach(player => {
        player.hand = gameState.deck.splice(0, 7); // Deal 7 cards
    });

    gameState.currentDiscard = []; // Clear discard pile
    gameState.selectedCards = [];  // Clear any selected cards
    gameState.currentPlayer = 0; // Start with the first player
}

// Handle player joining
io.on('connection', (socket) => {
    console.log('A user connected');

    // socket.on('joinGame', (playerName) => {
    //     const newPlayer = { id: socket.id, name: playerName, hand: [], score: 0 };
    //     players.push(newPlayer);
    //     gameState.players.push(newPlayer);

    //     socket.emit('gameJoined', { playerName });

    //     // Notify all players about the updated game state
    //     io.emit('gameUpdate', gameState);

    //     // If there are at least 2 players, start the game
    //     if (gameState.players.length >= 2 && !gameState.gameStarted) {
    //         startGame();
    //     }
    // });
    // socket.on('joinGame', (playerName) => {
    //     const newPlayer = { id: socket.id, name: playerName, hand: [], score: 0 };
    //     players.push(newPlayer);
    //     gameState.players.push(newPlayer);

    //     // Emit a 'gameJoined' event with the playerName to the joining player
    //     socket.emit('gameJoined', { playerName: newPlayer.name });

    //     // Notify all players about the updated game state
    //     io.emit('gameUpdate', gameState);

    //     // If there are at least 2 players, start the game
    //     if (gameState.players.length >= 2 && !gameState.gameStarted) {
    //         startGame();
    //     }
    // });

    // Set the maximum number of players
    socket.on('setMaxPlayers', (max) => {
        if (gameState.players.length > 0) {
            socket.emit('error', 'Max players can only be set by the first player.');
            return;
        }

        maxPlayers = max;
        socket.emit('maxPlayersSet', `Max players set to ${max}`);
    });

    socket.on('joinGame', (playerName) => {
        // if (maxPlayers && players.length >= maxPlayers) {
        //     socket.emit('error', 'The game is full!');
        //     return;
        // }

        const newPlayer = { id: socket.id, name: playerName, hand: [], score: 0 };
        players.push(newPlayer);
        gameState.players.push(newPlayer);

        socket.emit('gameJoined', { playerName });

        // Notify all players about the updated game state
        io.emit('gameUpdate', gameState);

        // If there are at least 2 players, start the game
        if (gameState.players.length >= maxPlayers && !gameState.gameStarted) {
            startGame();
        }
    });

    

    // Handle card selection
    socket.on('selectCard', (playerIndex, cardIndex) => {
        if (playerIndex !== gameState.currentPlayer) {
            socket.emit('error', 'It\'s not your turn!');
            return;
        }

        const player = gameState.players[playerIndex];
        const selectedCard = player.hand[cardIndex];

        if (gameState.selectedCards.length === 0) {
            // First card selected
            gameState.selectedCards.push(selectedCard);
        } else {
            // Check if the card matches the value of the already selected cards
            const firstCardValue = gameState.selectedCards[0].value;
            if (selectedCard.value === firstCardValue) {
                // Toggle the card in the selection
                const cardAlreadySelected = gameState.selectedCards.some(
                    card => card.value === selectedCard.value && card.suit === selectedCard.suit
                );

                if (cardAlreadySelected) {
                    // Deselect the card
                    gameState.selectedCards = gameState.selectedCards.filter(
                        card => !(card.value === selectedCard.value && card.suit === selectedCard.suit)
                    );
                } else {
                    // Select the card
                    gameState.selectedCards.push(selectedCard);
                }
            } else {
                socket.emit('error', 'You can only select cards with the same value.');
                return;
            }
        }

        io.emit('gameUpdate', gameState);
    });

    // Handle the action of picking a card (from discard or deck)
    socket.on('pickCard', (playerIndex, fromDiscardPile) => {
        const player = gameState.players[playerIndex];

        // If it's not the player's turn, deny the action
        if (playerIndex !== gameState.currentPlayer) {
            socket.emit('error', 'It\'s not your turn!');
            return;
        }

        if (gameState.gameOver) {
            socket.emit('error', 'Game Over!');
            return;
        }

        // If the player chooses to pick from the discard pile
        if (fromDiscardPile) {
            if (gameState.currentDiscard.length === 0) {
                socket.emit('error', 'The discard pile is empty!');
                return;
            }

            const cardPicked = gameState.currentDiscard.pop();
            player.hand.push(cardPicked);
        } else {
            if (gameState.deck.length === 0) {
                socket.emit('error', 'The deck is empty!');
                return;
            }

            const cardPicked = gameState.deck.pop();
            player.hand.push(cardPicked);
        }

        // After picking a card, discard selected cards
        if (gameState.selectedCards.length > 0) {
            gameState.currentDiscard.push(...gameState.selectedCards);
            gameState.selectedCards.forEach(card => {
                const cardIndex = player.hand.findIndex(
                    c => c.value === card.value && c.suit === card.suit
                );
                player.hand.splice(cardIndex, 1);
            });
            gameState.selectedCards = [];
        }

        // Advance to the next turn
        gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.players.length;
        io.emit('gameUpdate', gameState);
    });

    // // Handle callShow action
    // socket.on('callShow', (playerIndex) => {
    //     if (playerIndex !== gameState.currentPlayer) {
    //         socket.emit('error', 'It\'s not your turn!');
    //         return;
    //     }

    //     const caller = gameState.players[playerIndex];
    //     const callerSum = caller.hand.reduce((acc, card) => acc + card.value, 0);

    //     if (callerSum < 16) {
    //         const scores = gameState.players.map(player => player.hand.reduce((acc, card) => acc + card.value, 0));
    //         const minScore = Math.min(...scores);
    //         const winner = scores[playerIndex] === minScore;

    //         if (winner) {
    //             socket.emit('winner', `${caller.name} wins!`);
    //             io.emit('gameOver', gameState);
    //         } else {
    //             socket.emit('loser', `${caller.name} loses!`);
    //         }
    //     } else {
    //         socket.emit('error', `${caller.name} cannot call show! Total must be less than 16.`);
    //     }
    // });
    socket.on('callShow', (playerIndex) => {
        if (playerIndex !== gameState.currentPlayer) {
            socket.emit('error', 'It\'s not your turn!');
            return;
        }

        const caller = gameState.players[playerIndex];
        const callerSum = caller.hand.reduce((acc, card) => acc + card.value, 0);

        if (callerSum < 16) {
            const scores = gameState.players.map(player => player.hand.reduce((acc, card) => acc + card.value, 0));
            const minScore = Math.min(...scores);
            const winner = scores[playerIndex] === minScore;

            if (winner) {
                // Player wins
                io.emit('winner', `${caller.name} wins!`);
                gameState.players.forEach(player => {
                    if (player !== caller) {
                        player.score += player.hand.reduce((acc, card) => acc + card.value, 0);
                    }
                    player.hand = gameState.deck.splice(0, 7); // Re-deal the hand
                });
                resetHandsAndDeck(); // Reset hands and deck, but keep scores
                io.emit('gameOver', gameState);
            } else {
                // Player loses
                io.emit('loser', `${caller.name} loses!`);
                gameState.players.forEach(player => {
                    if (player === caller) {
                        // Apply 20-point penalty for the losing player
                        player.score += 20 + player.hand.reduce((acc, card) => acc + card.value, 0);
                    } else {
                        // Other players just add the sum of their cards to their score
                        player.score += player.hand.reduce((acc, card) => acc + card.value, 0);
                    }
                    player.hand = gameState.deck.splice(0, 7); // Re-deal the hand
                });
                resetHandsAndDeck(); // Reset hands and deck, but keep scores
                io.emit('gameUpdate', gameState);
            }
        } else {
            socket.emit('error', `${caller.name} cannot call show! Total must be less than 16.`);
        }

        // Eliminate players who have 50 or more points
        gameState.players = gameState.players.filter(player => player.score < 50);

        if (gameState.players.length <= 1) {
            gameState.gameOver = true;
            io.emit('gameOver', gameState);
        }
    });

    // When a player disconnects
    socket.on('disconnect', () => {
        console.log('A user disconnected');
        players = players.filter(player => player.id !== socket.id);
        gameState.players = gameState.players.filter(player => player.id !== socket.id);
        io.emit('gameUpdate', gameState);
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
