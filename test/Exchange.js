const Exchange = artifacts.require("./Exchange.sol");
const Token = artifacts.require("./MockToken.sol");

describe("Exchange", () => {
    const [buyer, seller] = web3.eth.accounts;
    let exchange, token;

    const etherDepositAmount = web3.toWei(1, "ether");
    const tokenDepositAmount = 10000;

    function deployExchange() {
        return Token.new()
            .then(res => {
                token = res;
            })
            .then(() => Exchange.new())
            .then(res => {
                exchange = res;
            });
    }

    describe("Funds Management", () => {
        describe("Ether", () => {
            before(() => {
                return deployExchange();
            });

            const etherDepositAmount = web3.toWei(1, "ether");
            it("deposit", () => {
                return exchange.deposit({from: buyer, value: etherDepositAmount})
                    .then(() => checkBalance(0, buyer, {available: etherDepositAmount, reserved: 0}));
            });

            it("withdrawal", () => {
                const etherWithdrawalAmount = web3.toWei(0.1, "ether");
                return exchange.withdraw(etherWithdrawalAmount, {from: buyer})
                    .then(() => checkBalance(0, buyer, {available: etherDepositAmount - etherWithdrawalAmount, reserved: 0}));
            });
        });

        describe("Token", () => {
            before(() => {
                return deployExchange();
            });

            const tokenDepositAmount = 1000;
            it("deposit", () => {
                return token.setBalance(tokenDepositAmount, {from: seller})
                    .then(() => token.approve(exchange.address, tokenDepositAmount, {from: seller}))
                    .then(() => exchange.depositToken(token.address, tokenDepositAmount, {from: seller}))
                    .then(() => checkBalance(token.address, seller, {available: tokenDepositAmount, reserved: 0}));
            });

            it("withdrawal", () => {
                const tokenWithdrawalAmount = 100;
                return exchange.withdrawToken(token.address, tokenWithdrawalAmount, {from: seller})
                    .then(() => checkBalance(token.address, seller, {available: tokenDepositAmount - tokenWithdrawalAmount, reserved: 0}));
            });
        });        
    });

    describe("Order Insertion", function() {
        this.timeout(100000);
        const etherDepositAmount = web3.toWei(1, "ether");
        const tokenDepositAmount = 10000;

        beforeEach(() => {
            orderId = 1;
            return deployExchange()
                .then(() => exchange.deposit({from: buyer, value: etherDepositAmount}))
                .then(() => token.setBalance(tokenDepositAmount, {from: seller}))
                .then(() => token.approve(exchange.address, tokenDepositAmount, {from: seller}))
                .then(() => exchange.depositToken(token.address, tokenDepositAmount, {from: seller}));
        });

        it("should insert a new buy order as first", () => {            
            const order = buy(100, 5);
            const orderState = {prev: 0, next: 0};
            const orderbookState = {firstOrder: 1, bestBid: 1, bestAsk: 0, lastOrder: 1};
            const newBidWatcher = exchange.NewBid();
            const newOrderWatcher = exchange.NewOrder();
            return testOrder(order, orderState, orderbookState)
                .then(() => {
                    let eventState = order;
                    eventState.id = 1;
                    checkNewOrderEvent(newOrderWatcher, eventState);
                })
                .then(() => checkNewBestOrderEvent(newBidWatcher, {price: order.price}))
                .then(() => checkBalance(0, order.from, {available: etherDepositAmount - order.total, reserved: order.total}));
        });

        it("should insert a new sell order as first", () => {
            const order = sell(100, 5);
            const orderState = {prev: 0, next: 0};
            const orderbookState = {firstOrder: 1, bestBid: 0, bestAsk: 1, lastOrder: 1};
            const newAskWatcher = exchange.NewAsk();
            const newOrderWatcher = exchange.NewOrder();
            return testOrder(order, orderState, orderbookState)
                .then(() => {
                    let eventState = order;
                    eventState.id = 1;
                    checkNewOrderEvent(newOrderWatcher, eventState);
                })
                .then(() => checkNewBestOrderEvent(newAskWatcher, {price: order.price}))
                .then(() => checkBalance(token.address, order.from, {available: tokenDepositAmount - order.amount, reserved: order.amount}));
        });

        it("should cancel the last single buy order", () => {
            const order = buy(100, 5);
            let orderId;
            const newBidWatcher = exchange.NewBid();
            return placeOrder(order)
                .then(id => orderId = id)
                .then(() => cancelOrder(orderId, order.from))
                .then(() => checkOrder(orderId, undefined))
                .then(() => checkOrderbook({firstOrder: 0, bestBid: 0, bestAsk: 0, lastOrder: 0}))
                .then(() => checkNewBestOrderEvent(newBidWatcher, {price: 0}))
                .then(() => checkBalance(0, order.from, {available: etherDepositAmount, reserved: 0}));
        });

        it("should cancel the last single sell order", () => {
            const order = sell(100, 5);
            let orderId;
            const newAskWatcher = exchange.NewAsk();
            return placeOrder(order)
                .then(id => orderId = id)
                .then(() => cancelOrder(orderId, order.from))
                .then(() => checkOrder(orderId, undefined))
                .then(() => checkOrderbook({firstOrder: 0, bestBid: 0, bestAsk: 0, lastOrder: 0}))
                .then(() => checkNewBestOrderEvent(newAskWatcher, {price: 0}))
                .then(() => checkBalance(token.address, order.from, {available: tokenDepositAmount, reserved: 0}));
        });
        
        it("should insert a new sell order, change the first order reference and update the best ask reference", () => {
            const order = sell(100, 5);
            const orderState = {prev: 0, next: 1};
            const orderbookState = {firstOrder: 2, bestBid: 0, bestAsk: 2, lastOrder: 1};
            let newAskWatcher;
            return placeOrder(sell(110, 5))
                .then(() => {
                    newAskWatcher = exchange.NewAsk();
                })
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 2, next: 0}))
                .then(() => checkNewBestOrderEvent(newAskWatcher, {price: order.price}));
        });

        it("should insert a new buy order, change the last order reference and update the best bid reference", () => {
            const order = buy(110, 5);
            const orderState = {prev: 1, next: 0};
            const orderbookState = {firstOrder: 1, bestBid: 2, bestAsk: 0, lastOrder: 2};
            let newBidWatcher;
            return placeOrder(buy(100, 5))
                .then(() => {
                    newBidWatcher = exchange.NewBid();
                })
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 0, next: 2}))
                .then(() => checkNewBestOrderEvent(newBidWatcher, {price: order.price}));
        });

        it("should insert a new buy order as first of buy orders", () => {
            const order = buy(50, 5);
            const orderState = {prev: 0, next: 1};
            const orderbookState = {firstOrder: 2, bestBid: 1, bestAsk: 0, lastOrder: 1};
            return placeOrder(buy(100, 5))
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 2, next: 0}));
        });

        it("should insert a new sell order as last of sell orders", () => {
            const order = sell(100, 5);
            const orderState = {prev: 1, next: 0};
            const orderbookState = {firstOrder: 1, bestBid: 0, bestAsk: 1, lastOrder: 2};
            return placeOrder(sell(50, 5))
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 0, next: 2}));
        });

        it("should insert a new buy order between two others", () => {
            const order = buy(110, 5);
            const orderState = {prev: 1, next: 2};
            const orderbookState = {firstOrder: 1, bestBid: 2, bestAsk: 0, lastOrder: 2};
            return placeOrder(buy(100, 5))
                .then(() => placeOrder(buy(120, 5)))
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 0, next: 3}))
                .then(() => checkOrder(2, {prev: 3, next: 0}));
        });

        it("should insert a new sell order between two others", () => {
            const order = sell(110, 5);
            const orderState = {prev: 1, next: 2};
            const orderbookState = {firstOrder: 1, bestBid: 0, bestAsk: 1, lastOrder: 2};
            return placeOrder(sell(100, 5))
                .then(() => placeOrder(sell(120, 5)))
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 0, next: 3}))
                .then(() => checkOrder(2, {prev: 3, next: 0}));
        });

        it("should insert a new sell order after the best buy order", () => {
            const order = sell(130, 5);
            const orderState = {prev: 1, next: 0};
            const orderbookState = {firstOrder: 1, bestBid: 1, bestAsk: 2, lastOrder: 2};
            return placeOrder(buy(100, 5))
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 0, next: 2}));
        });

        it("should insert a new buy order before the best sell order", () => {
            const order = buy(100, 5);
            const orderState = {prev: 0, next: 1};
            const orderbookState = {firstOrder: 2, bestBid: 2, bestAsk: 1, lastOrder: 1};
            return placeOrder(sell(130, 5))
                .then(() => testOrder(order, orderState, orderbookState))
                .then(() => checkOrder(1, {prev: 2, next: 0}));
        });

        it("should cancel a sell order from the middle of sell orders", () => {
            const order = sell(110, 5);
            const orderState = {prev: 1, next: 0};
            return placeOrder(sell(100, 5))
                .then(() => placeOrder(order))
                .then(() => placeOrder(sell(120, 5)))
                .then(() => cancelOrder(2, order.from))
                .then(() => checkOrder(2, undefined))
                .then(() => checkOrder(1, {prev: 0, next: 3}))
                .then(() => checkOrder(3, {prev: 1, next: 0}))
                .then(() => checkOrderbook({firstOrder: 1, bestBid: 0, bestAsk: 1, lastOrder: 3}));
        });

        it("should cancel a buy order from the middle of buy orders", () => {
            const order = buy(110, 5);
            const orderState = {prev: 1, next: 0};
            return placeOrder(buy(100, 5))
                .then(() => placeOrder(order))
                .then(() => placeOrder(buy(120, 5)))
                .then(() => cancelOrder(2, order.from))
                .then(() => checkOrder(2, undefined))
                .then(() => checkOrder(1, {prev: 0, next: 3}))
                .then(() => checkOrder(3, {prev: 1, next: 0}))
                .then(() => checkOrderbook({firstOrder: 1, bestBid: 3, bestAsk: 0, lastOrder: 3}));
        });
    });

    describe("Order Matching", function() {
        this.timeout(100000);
        const etherDepositAmount = web3.toWei(1, "ether");
        const tokenDepositAmount = 10000;

        beforeEach(() => {
            orderId = 1;
            return deployExchange()
                .then(() => exchange.deposit({from: buyer, value: etherDepositAmount}))
                .then(() => token.setBalance(tokenDepositAmount, {from: seller}))
                .then(() => token.approve(exchange.address, tokenDepositAmount, {from: seller}))
                .then(() => exchange.depositToken(token.address, tokenDepositAmount, {from: seller}));
        });

        it("the best buy order should be partially filled by a new sell order", () => {
            const buyOrder = buy(100, 5);
            const sellOrder = sell(90, 2);
            const tradeEventsStates = [{bidId: 1, askId: 2, side: false, amount: 2, price: buyOrder.price}];            
            const newTradeWatcher = exchange.NewTrade();
            return placeOrder(buyOrder)
                .then(() => placeOrder(sellOrder))
                .then(() => checkOrder(2, undefined))
                .then(() => checkOrder(1, {amount: buyOrder.amount - sellOrder.amount, prev: 0, next: 0}))
                .then(() => checkBalance(token.address, sellOrder.from, {available: tokenDepositAmount - sellOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, sellOrder.from, {available: sellOrder.amount * buyOrder.price, reserved: 0}))
                .then(() => checkBalance(token.address, buyOrder.from, {available: sellOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, buyOrder.from, {
                        available: etherDepositAmount - buyOrder.total, 
                        reserved: buyOrder.price * (buyOrder.amount - sellOrder.amount)
                    }))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 1, bestBid: 1, bestAsk: 0, lastOrder: 1}));
        });

        it("the best sell order should be partially filled by a new buy order", () => {
            const buyOrder = buy(100, 2);
            const sellOrder = sell(90, 5);
            const tradeEventsStates = [{bidId: 2, askId: 1, side: true, amount: 2, price: sellOrder.price}];            
            const newTradeWatcher = exchange.NewTrade();
            return placeOrder(sellOrder)
                .then(() => placeOrder(buyOrder))
                .then(() => checkOrder(2, undefined))
                .then(() => checkOrder(1, {amount: sellOrder.amount - buyOrder.amount, prev: 0, next: 0}))
                .then(() => checkBalance(token.address, sellOrder.from, {
                        available: tokenDepositAmount - sellOrder.amount, 
                        reserved: sellOrder.amount - buyOrder.amount
                    }))
                .then(() => checkBalance(0, sellOrder.from, {available: buyOrder.amount * sellOrder.price, reserved: 0}))
                .then(() => checkBalance(token.address, buyOrder.from, {available: buyOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, buyOrder.from, {
                        available: etherDepositAmount - sellOrder.price * buyOrder.amount, 
                        reserved: 0
                    }))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 1, bestBid: 0, bestAsk: 1, lastOrder: 1}));
        });

        it("a new sell order should be partially filled by the best buy order", () => {
            const buyOrder = buy(100, 2);
            const sellOrder = sell(90, 5);
            const tradeEventsStates = [{bidId: 1, askId: 2, side: false, amount: 2, price: buyOrder.price}];            
            const newTradeWatcher = exchange.NewTrade();
            return placeOrder(buyOrder)
                .then(() => placeOrder(sellOrder))
                .then(() => checkOrder(1, undefined))
                .then(() => checkOrder(2, {amount: sellOrder.amount - buyOrder.amount, prev: 0, next: 0}))
                .then(() => checkBalance(token.address, sellOrder.from, {available: tokenDepositAmount - sellOrder.amount, reserved: sellOrder.amount - buyOrder.amount}))
                .then(() => checkBalance(0, sellOrder.from, {available: buyOrder.total, reserved: 0}))
                .then(() => checkBalance(token.address, buyOrder.from, {available: buyOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, buyOrder.from, {available: etherDepositAmount - buyOrder.total, reserved: 0}))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 2, bestBid: 0, bestAsk: 2, lastOrder: 2}));
        });

        it("a new buy order should be partially filled by the best sell order", () => {
            const buyOrder = buy(100, 5);
            const sellOrder = sell(90, 2);
            const tradeEventsStates = [{bidId: 2, askId: 1, side: true, amount: 2, price: sellOrder.price}];            
            const newTradeWatcher = exchange.NewTrade();
            return placeOrder(sellOrder)
                .then(() => placeOrder(buyOrder))
                .then(() => checkOrder(1, undefined))
                .then(() => checkOrder(2, {amount: buyOrder.amount - sellOrder.amount, prev: 0, next: 0}))
                .then(() => checkBalance(token.address, sellOrder.from, {available: tokenDepositAmount - sellOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, sellOrder.from, {available: sellOrder.total, reserved: 0}))
                .then(() => checkBalance(token.address, buyOrder.from, {available: sellOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, buyOrder.from, {
                        available: etherDepositAmount - sellOrder.price * buyOrder.amount, 
                        reserved: buyOrder.price * (buyOrder.amount - sellOrder.amount)
                    }))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 2, bestBid: 2, bestAsk: 0, lastOrder: 2}));
        });

        it("a new sell order should be completely filled and completely fill the best buy order", () => {
            const buyOrder = buy(100, 2);
            const sellOrder = sell(90, 2);
            const tradeEventsStates = [{bidId: 1, askId: 2, side: false, amount: 2, price: buyOrder.price}];            
            const newTradeWatcher = exchange.NewTrade();
            return placeOrder(buyOrder)
                .then(() => placeOrder(sellOrder))
                .then(() => checkOrder(1, undefined))
                .then(() => checkOrder(2, undefined))
                .then(() => checkBalance(token.address, sellOrder.from, {available: tokenDepositAmount - sellOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, sellOrder.from, {available: buyOrder.total, reserved: 0}))
                .then(() => checkBalance(token.address, buyOrder.from, {available: buyOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, buyOrder.from, {available: etherDepositAmount - buyOrder.total, reserved: 0}))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 0, bestBid: 0, bestAsk: 0, lastOrder: 0}));
        });

        it("a new buy order should be completely filled and completely fill the best sell order", () => {
            const buyOrder = buy(100, 2);
            const sellOrder = sell(90, 2);
            const tradeEventsStates = [{bidId: 2, askId: 1, side: true, amount: 2, price: sellOrder.price}];            
            const newTradeWatcher = exchange.NewTrade();
            return placeOrder(sellOrder)
                .then(() => placeOrder(buyOrder))
                .then(() => checkOrder(1, undefined))
                .then(() => checkOrder(2, undefined))
                .then(() => checkBalance(token.address, sellOrder.from, {available: tokenDepositAmount - sellOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, sellOrder.from, {available: sellOrder.total, reserved: 0}))
                .then(() => checkBalance(token.address, buyOrder.from, {available: sellOrder.amount, reserved: 0}))
                .then(() => checkBalance(0, buyOrder.from, {available: etherDepositAmount - sellOrder.total, reserved: 0}))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 0, bestBid: 0, bestAsk: 0, lastOrder: 0}));
        });

        it("a new sell order should completely fill several buy orders", () => {
            let [buy1, buy2, buy3] = [buy(100, 2), buy(110, 3), buy(120, 4)]
            const sellOrder = sell(105, 10);
            const tradeEventsStates = [
                {bidId: 3, askId: 4, side: false, amount: buy3.amount, price: buy3.price},
                {bidId: 2, askId: 4, side: false, amount: buy2.amount, price: buy2.price}
            ];
            const newTradeWatcher = exchange.NewTrade();
            const expectedTokenSoldAmount = buy3.amount + buy2.amount;
            return placeOrder(buy1)
                .then(() => placeOrder(buy2))
                .then(() => placeOrder(buy3))
                .then(() => placeOrder(sellOrder))
                .then(() => checkOrder(1, {amount: buy1.amount}))
                .then(() => checkOrder(2, undefined))
                .then(() => checkOrder(3, undefined))
                .then(() => checkOrder(4, {amount: sellOrder.amount - expectedTokenSoldAmount}))
                .then(() => checkBalance(token.address, sellOrder.from, {available: tokenDepositAmount - sellOrder.amount, reserved: sellOrder.amount - expectedTokenSoldAmount}))
                .then(() => checkBalance(0, sellOrder.from, {available: buy3.total + buy2.total, reserved: 0}))
                .then(() => checkBalance(token.address, buy1.from, {available: expectedTokenSoldAmount, reserved: 0}))
                .then(() => checkBalance(0, buy1.from, {available: etherDepositAmount - (buy3.total + buy2.total + buy1.total), reserved: buy1.total}))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 1, bestBid: 1, bestAsk: 4, lastOrder: 4}));
        });

        it("a new buy order should completely fill several sell orders", () => {
            let [sell1, sell2, sell3] = [sell(120, 4), sell(110, 3), sell(100, 2)]
            const buyOrder = buy(115, 10);
            const tradeEventsStates = [
                {bidId: 4, askId: 3, side: true, amount: sell3.amount, price: sell3.price},
                {bidId: 4, askId: 2, side: true, amount: sell2.amount, price: sell2.price}
            ];
            const newTradeWatcher = exchange.NewTrade();
            const expectedTokenBoughtAmount = sell3.amount + sell2.amount;
            return placeOrder(sell1)
                .then(() => placeOrder(sell2))
                .then(() => placeOrder(sell3))
                .then(() => placeOrder(buyOrder))
                .then(() => checkOrder(1, {amount: sell1.amount}))
                .then(() => checkOrder(2, undefined))
                .then(() => checkOrder(3, undefined))
                .then(() => checkOrder(4, {amount: buyOrder.amount - expectedTokenBoughtAmount}))
                .then(() => checkBalance(token.address, sell1.from, {available: tokenDepositAmount - (sell3.amount + sell2.amount + sell1.amount), reserved: sell1.amount}))                
                .then(() => checkBalance(0, sell1.from, {available: sell3.total + sell2.total, reserved: 0}))
                .then(() => checkBalance(token.address, buyOrder.from, {available: expectedTokenBoughtAmount, reserved: 0}))
                .then(() => checkBalance(0, buyOrder.from, {
                        available: etherDepositAmount - (sell3.total + sell2.total + buyOrder.price * (buyOrder.amount - expectedTokenBoughtAmount)), 
                        reserved: buyOrder.price * (buyOrder.amount - expectedTokenBoughtAmount)
                    }))
                .then(() => checkTradeEvents(newTradeWatcher, tradeEventsStates))
                .then(() => checkOrderbook({firstOrder: 4, bestBid: 4, bestAsk: 1, lastOrder: 1}));
        });
    });

    function initBalances() {
        return exchange.deposit({from: buyer, value: etherDepositAmount})
            .then(() => token.setBalance(tokenDepositAmount, {from: seller}))
            .then(() => token.approve(exchange.address, tokenDepositAmount, {from: seller}))
            .then(() => exchange.depositToken(token.address, tokenDepositAmount, {from: seller}));
    }

    function checkBalance(token, trader, expectedBalance) {
        return exchange.getBalance(token, trader)
            .then(balance => {
                assert.equal(balance[0].toFixed(), expectedBalance.available, "available balance");
                assert.equal(balance[1].toFixed(), expectedBalance.reserved, "reserved balance");
            });
    }

    function sell(price, amount) {
        return {sell: true, price: price, amount: amount, from: seller, total: price * amount};
    }

    function buy(price, amount) {
        return {sell: false, price: price, amount: amount, from: buyer, total: price * amount};
    }

    function checkOrder(id, orderState) {
        if (orderState == undefined) {
            orderState = {price: 0, sell: false, amount: 0, prev: 0, next: 0};
        }

        return exchange.getOrder(token.address, id)
            .then(order => {
                if (orderState.price != undefined)
                    assert.equal(order[0].toFixed(), orderState.price, "price");
                if (orderState.sell != undefined)
                    assert.equal(order[1], orderState.sell, "order type");
                if (orderState.amount != undefined)
                    assert.equal(order[2].toFixed(), orderState.amount, "amount");
                if (orderState.next != undefined)
                    assert.equal(order[3].toFixed(), orderState.next, "next order");                
                if (orderState.prev != undefined)
                    assert.equal(order[4].toFixed(), orderState.prev, "prev order");
            });
    }

    function checkOrderbook(orderbookState) {
        return exchange.getOrderBookInfo(token.address)
            .then(orderbook => {
                assert.equal(orderbook[0].toFixed(), orderbookState.firstOrder, "first order");
                assert.equal(orderbook[1].toFixed(), orderbookState.bestBid, "best bid");
                assert.equal(orderbook[2].toFixed(), orderbookState.bestAsk, "best ask");
                assert.equal(orderbook[3].toFixed(), orderbookState.lastOrder, "last order");
            });
    }

    function checkTradeEvents(watcher, eventsState) {
        let events = watcher.get();
        assert.equal(events.length, eventsState.length);

        for (let i = 0; i < events.length; i++) {
            let event = events[i].args;
            let state = eventsState[i];
            assert.equal(event.token, token.address);
            assert.equal(event.bidId, state.bidId);
            assert.equal(event.askId, state.askId);
            assert.equal(event.side, state.side);
            assert.equal(event.amount, state.amount);
            assert.equal(event.price.toFixed(), state.price);
        }
    }

    function checkNewBestOrderEvent(watcher, expectedState) {
        let events = watcher.get();
        assert.equal(events.length, 1);

        let event = events[0].args;
        assert.equal(event.token, token.address);
        assert.equal(event.price.toFixed(), expectedState.price);
    }

    function checkNewOrderEvent(watcher, expectedState) {
        let events = watcher.get();
        assert.equal(events.length, 1);

        let event = events[0].args;
        assert.equal(event.token, token.address);
        assert.equal(event.owner, expectedState.from);
        assert.equal(event.id, expectedState.id);
        assert.equal(event.side, expectedState.side);
        assert.equal(event.price, expectedState.price);
        assert.equal(event.amount, expectedState.amount);
    }

    function placeOrder(order) {
        let placeOrderTestPromise;
        if (order.sell === true) {
            placeOrderTestPromise = exchange.sell(token.address, order.amount, order.price, {from: order.from});
        } else {
            placeOrderTestPromise = exchange.buy(token.address, order.amount, order.price, {from: order.from});
        }
        return placeOrderTestPromise.then(() => orderId++);
    }

    function cancelOrder(id, from) {
        return exchange.cancelOrder(token.address, id, {from: from});
    }

    let orderId = 1;
    function testOrder(order, orderItemState, orderbookState) {
        return placeOrder(order)
            .then(id => {
                let orderState;
                if (orderItemState != undefined) {
                    orderState = {
                        price: order.price, 
                        sell: order.sell, 
                        amount: orderItemState.amount != undefined ? orderItemState.amount : order.amount, 
                        prev: orderItemState.prev, 
                        next: orderItemState.next
                    };
                }
                return checkOrder(id, orderState);
            }).then(() => {
                return checkOrderbook(orderbookState);
            });
    }

});