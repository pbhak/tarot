import { WebClient } from '@slack/web-api'
import { transcript } from './transcript.js'
import { kv } from './kv.js'

export class SlackBot {
  constructor(token, channelId) {
    // Log token type (first 4 chars) to verify we're using the right token
    this.client = new WebClient(token)
    this.channelId = channelId
    this.rootMessage = null
    this.loadRootMessage().then(msg => {
      this.rootMessage = msg
    })
  }

  async loadRootMessage() {
    try {
      const file = Bun.file('.rootmessage')
      if (await file.exists()) {
        const text = await file.text()
        return JSON.parse(text)
      }
    } catch (error) {
      console.error('Error loading root message:', error)
    }
    return null
  }

  saveRootMessage() {
    try {
      Bun.write('.rootmessage', JSON.stringify(this.rootMessage))
    } catch (error) {
      console.error('Error saving root message:', error)
    }
  }

  async sendMessage(message, threadTs = null, username = null) {
    try {
      const messageParams = {
        channel: this.channelId,
        text: message
      }

      if (threadTs) {
        messageParams.thread_ts = threadTs
      }
      if (username) {
        messageParams.username = username
      }
      
      console.log('Sending message with params:', JSON.stringify(messageParams, null, 2))
      
      const result = await this.client.chat.postMessage(messageParams)
      
      if (!threadTs) {
        this.rootMessage = {
          channelId: result.channel,
          messageTs: result.ts
        }
        this.saveRootMessage()
      }
      
      return result
    } catch (error) {
      console.error('Error sending message to Slack:', error)
      throw error
    }
  }

  async initialMessage() {
    try {
      // Send initial message with black joker
      const result = await this.sendMessage('🃏')
      
      // Wait 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      // Send follow-up message in thread
      await this.sendMessage("ooooh! what's this deck of cards doing here?", result.ts, 'The Fool')

      // Wait 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Send follow-up message in thread
      await this.sendMessage("DRAW", result.ts, 'The Fool')

      // Wait 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      return result
    } catch (error) {
      console.error('Error sending initial message:', error)
      throw error
    }
  }

  async drawCard(messageTs, username) {
    // check if the user has already drawn a card in the past 30 seconds
    const userMention = username.startsWith('U') ? `<@${username}>` : username

    this.react(messageTs, 'beachball')

    try {
      await this.sendMessage(userMention + ' ' + transcript('drawing.start') + '...', messageTs)

      // Check rate limiting
      const lastDraw = await kv.get(`card_draw:${username}`)
      if (lastDraw) {
        // await this.sendMessage(`${userMention} draws too quickly!`)
        await this.sendMessage(userMention + ' ' + transcript('drawing.too_soon'), messageTs)
        return
      }

      kv.set(`card_draw:${username}`, true, 30 * 1000)

      // get the user's hand
      let userHand = await kv.get(`user_hand:${username}`, true)
      if (!userHand) {
        userHand = []
      }

      const allCards = transcript('cards')
      const cardKeys = Object.keys(allCards)
      const availableCards = cardKeys.filter(key => !userHand.includes(key))
      const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)]
      userHand.push(randomCard)
      kv.set(`user_hand:${username}`, userHand, null, true)

      const chosenCard = allCards[randomCard]
      const flavor = transcript('cards.' + randomCard + '.flavor')

      // Send the card result
      await this.sendMessage(
        `${userMention} draws the ${chosenCard.name}!\n_${flavor}_\n\nRequirements: ${chosenCard.requirements}`,
        messageTs
      )
    } catch (error) {
      console.error('Error in drawCard:', error)
      throw error
    }
  }

  async react(messageTs, name, turnOn = true) {
    const reaction = turnOn ? 'add' : 'remove'
    try {
      await this.client.reactions[reaction]({
        channel: this.channelId,
        timestamp: messageTs,
        name: name
      })
    } catch (error) {
      console.error("Failed to react to message:", messageTs, "with name:", name, "and turnOn:", turnOn)
    }
  }

  async handleMessageEvent(event) {
    try {
      // Check if this is a reply in our thread
      console.log('Received message event:', {
        thread_ts: event.thread_ts,
        root_message_ts: this.rootMessage?.messageTs,
        text: event.text,
        channel: event.channel,
        expected_channel: this.channelId,
        message_ts: event.ts,
        user: event.user,
        bot_id: event.bot_id
      })
      
      // Verify the message is in our channel
      if (event.channel !== this.channelId) {
        console.log('Message is not in our channel, ignoring')
        return
      }
      
      if (event.thread_ts === this.rootMessage?.messageTs) {
        // Check if the message is "DRAW"
        if (event.text.trim().toUpperCase() === 'DRAW') {
          console.log('DRAW command detected, calling drawCard with messageTs:', event.ts)
          // If it's a bot message, use the bot's username, otherwise use the user's ID
          const username = event.bot_id ? 'The Fool' : event.user
          await this.drawCard(event.ts, username)
        }
      } else {
        console.log('Message is not in our thread, ignoring')
      }
    } catch (error) {
      console.error('Error handling message event:', error)
    }
  }

  getRootMessage() {
    return this.rootMessage
  }
} 