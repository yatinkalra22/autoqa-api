# AutoQA Cost Analysis

> Breakdown of Gemini API costs per test run and monthly projections.

## Gemini 2.5 Flash Pricing (Pay-as-you-go)

| | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| Text / Image / Video | $0.30 | $2.50 |
| Audio | $1.00 | $2.50 |
| Context caching (text/image/video) | $0.03 | — |

Source: [Google AI Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)

> **Note:** Gemini 2.0 Flash ($0.10 input / $0.40 output per 1M tokens) is deprecated and shuts down June 1, 2026. We upgraded to 2.5 Flash for better vision accuracy.

---

## Token Estimates Per AI Call

Each Gemini call in the AutoQA pipeline has a different input/output profile. Screenshots are the dominant cost — a single 1280x800 PNG screenshot is roughly **1,000–1,500 tokens** as an inline image.

| AI Call | Input Tokens (est.) | Output Tokens (est.) | Description |
|---------|--------------------:|---------------------:|-------------|
| **Planner** | ~2,000 | ~150 | System prompt (~500) + screenshot (~1,200) + history (~300) |
| **Detector** | ~1,500 | ~100 | Prompt (~300) + screenshot (~1,200) |
| **Verifier** | ~2,800 | ~120 | Prompt (~400) + 2 screenshots (~2,400) |
| **Validator** | ~4,500 | ~200 | Prompt (~300) + up to 3 screenshots (~3,600) + step history (~600) |

---

## Cost Per Test Run

### Gemini Calls Per Step

Each step in the agentic loop makes these calls:

| Call | When | Count per step |
|------|------|----------------|
| Planner | Every step | 1 |
| Detector | `click`, `type`, `hover` steps | 0 or 1 (+ 1 retry if needed) |
| Verifier | `click`, `type` steps | 0 or 1 |
| Validator | Once at the end | 1 total (not per step) |

### Example: 3-Step Login Test

A typical "test login with wrong credentials" run:
1. **type** email field → Planner + Detector + Verifier = 3 calls
2. **type** password field → Planner + Detector + Verifier = 3 calls
3. **click** submit button → Planner + Detector + Verifier = 3 calls
4. Final validation → Validator = 1 call

**Total: 10 Gemini calls** (up to 13 if any detection retries occur)

| | Input Tokens | Output Tokens |
|---|---:|---:|
| 3x Planner | 6,000 | 450 |
| 3x Detector | 4,500 | 300 |
| 3x Verifier | 8,400 | 360 |
| 1x Validator | 4,500 | 200 |
| **Total** | **23,400** | **1,310** |

**Cost per 3-step run:**
- Input: 23,400 / 1,000,000 x $0.30 = **$0.0070**
- Output: 1,310 / 1,000,000 x $2.50 = **$0.0033**
- **Total: ~$0.01 per run**

### Example: 10-Step Complex Flow

A more complex test (e.g., sign up, fill profile, navigate, verify):
- 10 steps, ~8 needing detection, ~7 needing verification

| | Input Tokens | Output Tokens |
|---|---:|---:|
| 10x Planner | 20,000 | 1,500 |
| 8x Detector | 12,000 | 800 |
| 7x Verifier | 19,600 | 840 |
| 1x Validator | 4,500 | 200 |
| **Total** | **56,100** | **3,340** |

**Cost per 10-step run:**
- Input: 56,100 / 1,000,000 x $0.30 = **$0.0168**
- Output: 3,340 / 1,000,000 x $2.50 = **$0.0084**
- **Total: ~$0.025 per run**

### Example: 20-Step Max Run

Hitting the default step limit:

| | Input Tokens | Output Tokens |
|---|---:|---:|
| 20x Planner | 40,000 | 3,000 |
| 16x Detector | 24,000 | 1,600 |
| 14x Verifier | 39,200 | 1,680 |
| 1x Validator | 4,500 | 200 |
| **Total** | **107,700** | **6,480** |

**Cost per 20-step run:**
- Input: 107,700 / 1,000,000 x $0.30 = **$0.0323**
- Output: 6,480 / 1,000,000 x $2.50 = **$0.0162**
- **Total: ~$0.05 per run**

---

## Monthly Projections

| Usage Level | Runs/day | Avg steps | Monthly Runs | Est. Monthly Cost |
|-------------|----------|-----------|-------------:|------------------:|
| Solo dev / light | 5 | 5 | 150 | **$2 – $4** |
| Small team | 20 | 8 | 600 | **$10 – $15** |
| CI/CD integration | 50 | 10 | 1,500 | **$25 – $40** |
| Heavy / enterprise | 200 | 12 | 6,000 | **$100 – $180** |

---

## Cost of Verification (Trade-off)

The self-verification step (comparing before/after screenshots) adds ~1 extra Gemini call per `type`/`click` action. Here's the cost impact:

| Scenario | Without Verification | With Verification | Increase |
|----------|---------------------:|------------------:|---------:|
| 3-step login | $0.006 | $0.010 | +67% |
| 10-step flow | $0.015 | $0.025 | +67% |
| 20-step max | $0.029 | $0.049 | +69% |

**The verification step roughly adds 65–70% to the Gemini API cost per run.**

However, without verification:
- Steps can silently pass when they actually failed (false positives)
- Tests report PASS/FAIL based on incorrect step history
- Debugging requires manually inspecting screenshots

**Recommendation:** Keep verification enabled by default. At ~$0.01–0.02 extra per run, the accuracy gain far outweighs the cost. For high-volume CI/CD pipelines where cost is a concern, verification could be made an opt-in flag.

---

## Other Costs (Non-Gemini)

| Resource | Notes |
|----------|-------|
| **Playwright/Chromium** | CPU + memory on your server. Each concurrent run uses ~200–400MB RAM. |
| **Redis** | BullMQ job queue. Minimal — a few KB per job. |
| **PostgreSQL** | Run metadata, step records. ~1–5KB per run. |
| **Screenshot storage** | PNG screenshots stored locally. ~200–500KB per screenshot, ~1–5MB per run. |
| **Server compute** | Main cost outside of Gemini. A $5–20/mo VPS handles light usage; heavier loads need more. |

---

## Cost Optimization Strategies

1. **Batch API** — Gemini offers 50% discount on batch requests ($0.15 input / $1.25 output per 1M tokens). Useful for scheduled/non-urgent test suites.
2. **Context caching** — Cache the system prompt for planner/detector ($0.03 vs $0.30 per 1M cached input tokens). Saves ~15–20% on input costs for repeated runs.
3. **Selective verification** — Only verify `type` actions (where silent failures are most common), skip verification for `click` actions that trigger obvious page navigation.
4. **Screenshot compression** — Resize screenshots or use JPEG instead of PNG to reduce image token count.
5. **Smarter step limits** — Lower default `maxSteps` for simple tests. A login test rarely needs 20 steps.
