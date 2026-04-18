# Onboarding Bot Integration API Documentation

This document outlines the API endpoints, underlying agent architecture, and automated event triggers implemented for the ARIA 3-Agent Onboarding System.

## Base URL
Prefix all standard Onboarding module routes with `/onboarding` as mounted in your `app.js`.

---

## 1. Automated Event Triggers

The onboarding pipeline natively operates as a background routine and normally does not require manual API invocation.

### Trigger: `Team Invitation Acceptance`
When a developer accepts an invitation to join a team *and* that invitation is specifically bounded to a `projectId`, the background pipeline activates immediately.

*   **Logic Link:** Inside `team.service.js` under `respondToInvite` (`decision === 'accept'`).
*   **Action:** Executes `triggerOnboarding({ projectId, newMemberId })` in "fire-and-forget" mode. The API instantly returns the 201 acceptance response to the user while the orchestrator works in the background.
*   **Response Delivery:** Sent directly to the client via Socket.io once Gemini completes the processing.

---

## 2. API Endpoints

These endpoints are manual overrides intended for Team Leads or System Admins to re-trigger onboarding if a user missed their initial message or if a failure occurred. 

All these endpoints are mounted at `/onboarding` and **require authentication (`protect` middleware)**.

### `POST /onboarding/trigger`
Fires the onboarding pipeline for a specific developer asynchronously.
*   **Middleware:** `protect`
*   **Body:**
    ```json
    { 
      "projectId": "651a2b3c4d5e6f7g8h9i0j11",
      "memberId": "651a2b3c4d5e6f7g8h9i0j22"
    }
    ```
*   **Response (202 Accepted):**
    ```json
    {
      "status": "accepted",
      "message": "Onboarding pipeline triggered. ARIA will deliver the message via Socket.io.",
      "data": { 
        "projectId": "651a2b3c4d5e6f7g8h9i0j11", 
        "memberId": "651a2b3c4d5e6f7g8h9i0j22" 
      }
    }
    ```

### `POST /onboarding/trigger/sync`
Fires the onboarding pipeline synchronously and waits upwards of 15 seconds for the entire 3-Agent architecture to finish, returning the final AI message directly into the HTTP response. Ideal for testing/dev environments.
*   **Middleware:** `protect`
*   **Body:**
    ```json
    { 
      "projectId": "651a2b3c4d5e6f7g8h9i0j11",
      "memberId": "651a2b3c4d5e6f7g8h9i0j22"
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "status": "success",
      "message": "Onboarding message generated successfully.",
      "data": {
        "onboardingMessage": {
          "subject": "Welcome to the Machine.",
          "greeting": "John — you've been authenticated into the Alpha codebase. ARIA standing by.",
          "projectSnapshot": "...",
          "priorityFiles": "- **.env** — Setup required.\n- **docker-compose.yml** — Root network setup.",
          "bottleneckAlerts": "- ⚠ socket.io: Real-time traffic requires namespace isolation.",
          "firstMission": "Task: Scaffold Authentication | Est: 4 hrs | Urgency: HIGH",
          "closingSignal": "The codebase is live. Good hunting."
        },
        "meta": {
          "totalDurationMs": 4200,
          "phases": { "dataMining": {}, "contextSynthesis": {}, "personaWriting": {} }
        }
      }
    }
    ```

---

## 3. Agent Architecture (Internal)

If you are developing inside the `/agents` folder, understand how the orchestrator manages boundaries:

### **Agent 1: Data Miner (`dataMiner.agent`)**
Dual-track scraping script utilizing `Promise.allSettled`. 
*   Fetches DB context.
*   Reads decrypted GitHub tokens to pull `README.md` and `package.json` dynamically via HTTP. Tolerates GitHub 403/429 limits by simply reverting to local database metadata.

### **Agent 2: Context Synthesizer (`contextSynthesizer.agent`)**
Pure synchronous logic tree.
*   Maps raw tech strings into human categories (e.g. `Framework`, `Database`, `Queue`).
*   Matches project signatures against known bottlenecks (`bullmq`, `webpack`, `socket.io`).
*   Spawns specific starting anchors based on the tech stack.

### **Agent 3: Persona Writer (`personaWriter.agent`)**
The LLM gateway point.
*   Connects exclusively via `@google/generative-ai`.
*   Governed by the `ARIA_SYSTEM_PROMPT` ensuring structured JSON output without traditional chatbox pleasantries.

---

## 4. Error Formats

If the Gemini API triggers a Hard Failure (500) during a sync call, or the prompt output breaks out of the JSON enforcement, the bot falls back to an offline default format:

```json
{
  "status": "partial",
  "message": "Pipeline completed with errors — fallback message returned.",
  "data": {
    "onboardingMessage": {
      "subject": "Welcome to Alpha, John",
      "greeting": "John — you're now authenticated into the Alpha codebase. ARIA is standing by.",
      "projectSnapshot": "...",
      "priorityFiles": "...",
      "bottleneckAlerts": "Automated analysis unavailable — perform manual dependency review.",
      "firstMission": "...",
      "closingSignal": "The stack is live. The clock is ticking. Ship clean code.",
      "_fallback": true
    }
  }
}
```
*Note the `_fallback` flag is injected to trace failures in monitoring.*
