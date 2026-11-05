# Freemium benchmarks and pricing design for an AI video product (research date: 4 November 2026)

Source-quality labels used below:
- **Opened**: I read the page itself, through a fetch tool that returns extracted text.
- **Snippet**: I saw only a search-result summary and did not open the page.
- **Calc**: my own arithmetic on cited figures.
- **Judgment**: my opinion, not a sourced fact.

## Is 9% a safe planning number, and where does it come from?

### Takeaway
No. I found one literal source for "9% of free accounts convert": a ProductLed survey of 600+ B2B SaaS companies, with no stated time window, whose figure blends free trials and freemium. It does not describe self-serve freemium for a low-priced creator tool. **Judgment: plan on 3% of signups becoming paid within 6 months (low 1.5%, high 6%).** 9% is defensible only if the denominator is activated users.

### Cited Findings

**The literal source of 9%**
- ProductLed: "Overall, 9% of free accounts convert to paid accounts", and "all models convert at the same rate – on average 9%". A later line calls it a "9% conversion rate (median)", so the page is inconsistent on average vs median. No time window is stated. Sample is "600+ SaaS businesses", surveyed with Gainsight and RevOps. The page is dated 6 Feb 2025 but its findings refer to plans for 2022, so the data is probably about 2021-22. ACV is segmented starting at sub-$1K, with $1K-$5K the highest median at 10%. — [ProductLed](https://productled.com/blog/product-led-growth-benchmarks) (opened; vendor: ProductLed sells PLG training)
- Userpilot repeats it as "about 9% of free accounts convert to paid" and frames it as the rate for companies first adopting PLG. — [Userpilot](https://userpilot.com/blog/freemium-to-premium) (opened; vendor, secondary)

**Three other populations that 9% could really describe**
- The ~8% median across *all* products, trials included. ChartMogul's own caveat: "But very few products actually have an 8% conversion rate." The freemium distribution is close to bimodal: 25% of products below 2.5%, 29% at 2.5-7.5%, 25% at 10-15%. — [ChartMogul with ProductLed, Kyle Poyar, 200 B2B software products, surveyed Jan 2026, published 4 Feb 2026](https://chartmogul.com/reports/saas-conversion-report/) (opened; vendor: ChartMogul sells subscription analytics)
- **Visitor-to-signup, a different funnel step.** ChartMogul has freemium at 9% of visitors signing up. Lenny has about 9% for freemium sign-up rate. This is a strong candidate for a garbled retelling. — [ChartMogul 2026](https://chartmogul.com/reports/saas-conversion-report/); [Lenny's Newsletter, Aug 2023](https://lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion) (both opened)
- The top quartile of freemium. ChartMogul's "great" (75th percentile) for freemium is 8-12%, against "good" (50th percentile) of 3-5%. — [ChartMogul 2026](https://chartmogul.com/reports/saas-conversion-report/)

**Benchmarks by model (signup-to-paid unless stated)**

| Source, year, sample | Freemium | Opt-in trial (no card) | Opt-out trial (card) | Window and denominator | Bias |
|---|---|---|---|---|---|
| [ChartMogul/ProductLed/Poyar, Jan 2026, n=200 B2B](https://chartmogul.com/reports/saas-conversion-report/) | Good 3-5%, great 8-12% | Good 4-6%, great 10-15% | Good 25-35%, great 50-60% | 6 months; leads or free signups | Vendor; self-reported |
| [Lenny with OpenView, Growth Unhinged, Pendo, published Aug 2023, n=1,000+, mostly B2B](https://lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion) | Self-serve good 3-5%, great 6-8%; sales-assist good 5-7%, great 10-15% | All trials: good 8-12%, great 15-25% | Not split | 6 months; new accounts, account-level | Survey; B2B-weighted |
| [First Page Sage, data 2022-2026, updated 14 Oct 2026, n=80+ clients](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/) | Traditional 3.4%; land and expand 3.7%; industry range 2.1-5.6% | 17.3% | 49.1% | Window not stated; free users | SEO agency's own unaudited clients |
| [ProductLed, about 2021-22, n=600+](https://productled.com/blog/product-led-growth-benchmarks) | 9% (all models blended) | 9% (all models blended) | Not split | Not stated; free accounts | Vendor |
| [Buffer, one company, 2015-Jan 2018 signups, about 3.7M users](https://bufferapp.github.io/analysis/free_to_paid_conversion.html) | 2.3% within 6 months; 2.9% eventually | n/a | n/a | Signups | First-party, older, but a low-priced prosumer tool |
| [RevenueCat 2026, 115,000+ mobile apps, 2025 data](https://www.revenuecat.com/state-of-subscription-apps/) | 2.1% (day 35 from download); hard paywall 10.7% | n/a | Trial-to-paid 22.2% for Photo & Video | Day 35; downloads | Vendor; mobile only; download denominator is wider than signup |

Other distribution points:
- Lenny (2023) freemium: 20% of products below 2.5%, 33% at 2.5-5%, about 15% above 20%. — [Lenny](https://lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion)
- The top 20% of self-serve products convert about 10x the bottom 20%. — [ChartMogul 2026](https://chartmogul.com/reports/saas-conversion-report/)

Benchmark conflict to note: First Page Sage reports 3.4% traditional freemium on its current page, while [Userpilot](https://userpilot.com/blog/freemium-to-premium) quotes First Page Sage at 3.7% on 2021-2025 data. The page changes over time and its underlying data cannot be audited.

**Visitor-to-signup (different denominator)**
- Freemium: 9% (ChartMogul 2026); 12% median, range 2-18% (ProductLed); 12.8% (First Page Sage).
- Free trial: 4.5% (ChartMogul 2026); 5% median, range 3-10% (ProductLed).
- Opt-in trial 7.6% and opt-out trial 2.7% (First Page Sage). Card-required trial 3.5% (ChartMogul 2026).
- Sources: [ChartMogul](https://chartmogul.com/reports/saas-conversion-report/); [ProductLed](https://productled.com/blog/product-led-growth-benchmarks); [First Page Sage](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)

**Visitor-to-paid (the fairest cross-model comparison)**
- ChartMogul, payers per 1,000 visitors: freemium 5; ungated freemium 5.6; trial 3.6; card-required trial 10.5. — [ChartMogul 2026](https://chartmogul.com/reports/saas-conversion-report/)
- Calc from First Page Sage: freemium 12.8% x 3.4% = 0.44%; opt-in trial 7.6% x 17.3% = 1.31%; opt-out trial 2.7% x 49.1% = 1.33%. — [First Page Sage](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)

**Activated-to-paid and qualified-lead conversion**
- I found no clean published benchmark for activated-to-paid. The closest is ProductLed: free trials using product-qualified leads convert 25% on average (10% at the 25th percentile, 50% at the 75th). Only about 24-25% of companies use PQLs. — [ProductLed](https://productled.com/blog/product-led-growth-benchmarks)
- Activation rate: Lenny's survey of 500+ products has SaaS average 36%, median 30%. All products: average 34%, median 25%. Definitions vary by product. — [Lenny](https://www.lennysnewsletter.com/p/what-is-a-good-activation-rate) (snippet)

**Does "eventually" rescue the number?**
- Mostly no. At Buffer, 2.3% converted within 6 months and 2.9% eventually, so about 82% of all converters arrived in the first 6 months. — [Buffer](https://bufferapp.github.io/analysis/free_to_paid_conversion.html) (2018, single company)
- Freemium does have a long tail: 23% of freemium conversions on mobile happen after 6 weeks. — [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/)

### Inferences

**Why 9% is unsafe**
1. **Wrong population.** It is B2B, blends trials with freemium, and comes from voluntary survey respondents who already run PLG.
2. **Wrong statistic for a new product.** A median of a near-bimodal distribution describes few real companies, and the survey has no pre-launch or just-launched weighting.
3. **Wrong sign on the error.** Overstating conversion also overstates how much free compute the business can afford.

**Recommended planning range (Judgment; these are not sourced benchmarks)**

| Metric | Low | Base | High | Reasoning |
|---|---|---|---|---|
| Signup-to-paid, 6 months, self-serve freemium | 1.5% | **3%** | 6% | Base sits at the bottom of "good" (3-5%) in both 2023 and 2026 surveys, and near First Page Sage (3.4%) and Buffer (2.3-2.9%). Low reflects the 20-25% of products below 2.5%, plus mobile consumer data (2.1%) and weaker conversion in India and SE Asia. High is the bottom of Lenny's "great" tier for self-serve (6-8%). |
| Activated-to-paid (derived) | 6% | **10%** | 15% | Calc: signup rate divided by an assumed activation rate of 25% / 30% / 40%. Assumes nearly all payers come from activated users. |
| Card-required trial, trial-to-paid | 15% | **22%** | 30% | Photo & Video 22.2% is the closest category data; ChartMogul "good" is 25-35% but B2B. |

Use 9% only if the denominator is explicitly activated users, where it sits slightly below base. Reforecast from your own cohorts once you have at least one 3-month cohort and then a 6-month cohort. Always state the denominator and the window beside the number.

**Illustrative sensitivity (Calc on invented inputs: 10,000 signups, $15 per month, 60% gross margin, 12% monthly churn)**

| Conversion | New payers | Starting MRR from cohort | Free-user signups per payer | Free compute per payer at $0.50 per signup | Same at $2 per signup |
|---|---|---|---|---|---|
| 9% | 900 | $13,500 | 11 | $5.56 | $22 |
| 6% | 600 | $9,000 | 17 | $8.33 | $33 |
| 3% | 300 | $4,500 | 33 | $16.67 | $67 |
| 1.5% | 150 | $2,250 | 67 | $33.33 | $133 |

Gross-profit LTV in this example is $15 x 0.6 / 0.12 = $75 (simple 1/churn formula). At $2 of free compute per signup, 3% consumes almost all of it and 1.5% is a loss, while a founder planning on 9% would see a healthy business. Rule of thumb (Judgment): allow free compute per signup of no more than conversion x LTV / 3. That gives $0.75 at base, against $2.25 if 9% were believed.

### Gaps
- I could not fetch OpenView's original reports. The accessible OpenView data is its co-run survey in Lenny's 2023 post. Secondary sites attribute 2-5% median to OpenView 2022 but I did not verify that.
- The Lenny and Growth Unhinged conversion posts are partly paywalled, so I saw only their visible sections.
- ProductLed's exact survey year and methodology are not stated on the page.
- No benchmark set isolates AI video or creator tools on a signup-to-paid basis.
- I found no a16z conversion dataset in this research window and did not retrieve an a16z source.
- Paddle/ProfitWell: I found churn data, but no free-to-paid conversion dataset.

## What is different for AI products?

### Takeaway
AI products convert slightly better up front, then lose customers faster and keep less margin on each one. Early conversion is therefore a weaker signal of value for AI than for classic SaaS. Plan on higher churn and lower margin even if conversion looks good.

### Cited Findings

**Conversion**
- AI-native and AI+SaaS hybrid: good 6-8%, great 15-20%. SaaS: good 5-7%, great 12-16%. — [ChartMogul 2026](https://chartmogul.com/reports/saas-conversion-report/). Only 9% of the sample is AI-native and 30% hybrid ([Growth Unhinged](https://www.growthunhinged.com/p/free-to-paid-conversion-report)), so Calc: about 18 and 60 products.
- Mobile AI vs non-AI: trial-to-paid 8.5% vs 5.6%; download-to-paid 2.4% vs 2.0%. — [TechCrunch on RevenueCat 2026](https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows) (opened; secondary)

**Retention**
- 12-month subscription retention, AI vs non-AI: annual plans 21.1% vs 30.7%; monthly 6.1% vs 9.5%. — [RevenueCat AI retention study, Aug 2026; subscriptions started Jul 2024-Jun 2025; 3,519 app configurations; 50M+ paid subscriptions](https://www.revenuecat.com/blog/growth/ai-app-retention-study) (opened; vendor)
- Weekly plans, AI 2.5% vs non-AI 1.7% per [TechCrunch](https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows); other coverage reported different figures, so treat weekly as unsettled.
- Photo & Video leans toward *low* retention among AI apps; apps launched in 2024 or later lean low by 20.2 points. RevenueCat describes these as patterns, not causes. — [RevenueCat study](https://www.revenuecat.com/blog/growth/ai-app-retention-study)
- First renewal on monthly plans: 57.9% for high-retention apps vs 30.2% for low. Third renewal: 79.5% vs 68.5%. — [RevenueCat study](https://www.revenuecat.com/blog/growth/ai-app-retention-study)
- Web/SaaS, annualized, 2025 data, businesses at $250K+ ARR: AI-native median GRR 40%, NRR 48%; B2B SaaS median NRR 82%; B2C SaaS median NRR 49%. AI-native GRR rose from 27% in January to 40% in September. — [ChartMogul, The AI churn wave, Dec 2025](https://chartmogul.com/reports/saas-retention-the-ai-churn-wave/) (opened; vendor; AI-native buckets about 50 companies each, which the author calls directional)
- Price is the sharpest divider. AI-native GRR under $50 per month: 23%; $50-$249: 45%; over $250: 70%. — [ChartMogul](https://chartmogul.com/reports/saas-retention-the-ai-churn-wave/)
- Refunds: 4.2% vs 3.5% median. — [TechCrunch on RevenueCat](https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows)
- Revenue: Y1 realized LTV per payer on annual plans $30.16 vs $21.37; monthly $18.92 vs $13.59. — [TechCrunch on RevenueCat](https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows)

**Gross margin**
- Bessemer: Supernovas about 25% ("often negative"); Shooting Stars about 60%. — [Bessemer State of AI, Aug 2025, 20 startups](https://www.bvp.com/atlas/the-state-of-ai-2025) (opened; investor-selected sample)
- ICONIQ: AI product gross margin 45% in 2025, projected 53% in 2026 and 59% in 2027; application-layer projected 60% in 2027. — [SaaStr on ICONIQ, about 305 executives, Q2 2026](https://saastr.com/the-builders-economy-10-metrics-from-iconiqs-newest-2026-state-of-ai-report) (opened; secondary; self-reported and partly projections; an earlier edition [reportedly](https://www.saastr.com/the-execution-era-of-ai-5-key-takeaways-from-iconiqs-state-of-ai-report) gave 52% for 2026)

**Pricing trend**
- ICONIQ: subscription 57%; consumption up from 35% to 42%; outcome-based up from 18% to 23%; 1.7 models per company. Only 15% of consumption-priced companies absorb all inference cost. — [SaaStr on ICONIQ](https://saastr.com/the-builders-economy-10-metrics-from-iconiqs-newest-2026-state-of-ai-report)
- Poyar's experience: 70-80% of token use comes from about 10% of users. "Most AI spend" is probably now credit-based (his estimate, unmeasured). — [Growth Unhinged, Sep 2025](https://kylepoyar.substack.com/p/ai-credit-pricing) (opened in part; sponsored by Metronome)
- Supporting free users "has gotten much more expensive as AI token costs have remained high". — [Growth Unhinged, Feb 2026](https://www.growthunhinged.com/p/free-to-paid-conversion-report)

### Inferences
- Judgment: for models, assume 50-60% gross margin at best, computed at the fully loaded cost including failed jobs and free users shown separately. The widely quoted SaaS 80-90% habit does not apply. I did not source that SaaS figure here, so treat it as general background.
- Concentrated usage means an "average user" cost estimate is misleading. Model the 90th-percentile user as well.

### Gaps
- No public gross-margin data specific to AI video products.
- ICONIQ's primary report was not opened; its figures here are via SaaStr.
- No a16z retention data retrieved.
- The Growth Unhinged post's guardrail section is paywalled.

## How much churn should a low-priced creator tool plan for, and what do annual plans do?

### Takeaway
Judgment: plan 12% monthly churn (range 7% to 20%) for a sub-$50 AI creator tool on monthly billing, which means a lifetime of about 8 months. Annual plans clearly correlate with better retention and more cash, but part of that is selection, and prepaid annual compute is a real liability.

### Cited Findings
- ProfitWell: under $100 monthly ARPU, monthly gross dollar churn is 3-16%, with a median of 6-9%. — [ProfitWell](https://profitwell.com/blog/average-revenue-churn-rate-benchmarks) (snippet; 3,000+ subscription companies; year not confirmed)
- ProfitWell via Lenny: consumer SaaS good 3-5%, great under 2%. — [Lenny, Feb 2022](https://www.lennysnewsletter.com/p/monthly-churn-benchmarks) (opened; older than the preferred range; top-percentile focus, so "good" here is demanding)
- Annual effect on web: median NRR is 10-20 points higher on annual than monthly plans. The report recommends annual as default, an annual ask in months 2-3, and bigger discounts (Grammarly at 60%). — [ChartMogul, Dec 2025](https://chartmogul.com/reports/saas-retention-the-ai-churn-wave/)
- Annual effect on mobile: apps whose top plan is annual earn $0.46 revenue per install at day 60 vs $0.24 for monthly-dominant. — [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/)
- Trial cancellations concentrate on day 0 (55.4% for 3-day trials). 31% of Google Play cancellations are billing failures vs 14% on the App Store. — [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/)
- Monthly realized LTV: high-priced apps $35.89 vs low-priced $6.67. — [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/)
- Conflict on price: ChartMogul finds higher price retains much better for AI-native web products ([report](https://chartmogul.com/reports/saas-retention-the-ai-churn-wave/)). RevenueCat finds the cheapest subscriptions over-represented among high retainers, by 7.3 points ([study](https://www.revenuecat.com/blog/growth/ai-app-retention-study)). These compare different things: dollar retention across web companies vs relative rank within mobile plan lengths.

### Inferences
**Implied constant monthly churn (Calc: 1 minus annual retention to the power 1/12)**

| Dataset | 12-month figure | Implied monthly churn |
|---|---|---|
| RevenueCat AI apps, monthly plan, low / mid / high group | 1.6% / 4.2% / 10.9% | 29% / 23% / 17% |
| RevenueCat AI apps vs non-AI, monthly plan | 6.1% vs 9.5% | 21% vs 18% |
| ChartMogul AI-native, under $50 | 23% GRR | 11.5% |
| ChartMogul AI-native, $50-$249 | 45% GRR | 6.4% |
| ChartMogul AI-native, over $250 | 70% GRR | 2.9% |

These flatten a front-loaded curve: a first-renewal rate of 30-58% means the first month is far worse than the average and later months are better. RevenueCat also counts a plan switch as churn, so it overstates loss.

**Planning range (Judgment)**

| Case | Monthly churn | Implied lifetime (1/churn) | Basis |
|---|---|---|---|
| High (good) | 7% | 14 months | Near ProfitWell's median for low ARPU; requires working professionals with recurring use |
| **Base** | **12%** | **8.3 months** | ChartMogul's sub-$50 AI figure |
| Low (bad) | 20% | 5 months | RevenueCat AI monthly-plan level |

- LTV example (Calc): at $15 and 60% margin, gross-profit LTV is $129 / $75 / $45 for 7% / 12% / 20% churn.
- A tool aimed at already-earning creators should be able to beat the base case, and a price above $50 appears to help materially (ChartMogul), but this has to be shown in your own data. Judgment.
- Annual-plan discount cuts revenue and locks you into a compute obligation. Grant allowance monthly, not as a one-year lump sum, so annual buyers cannot drain the year in one month. Judgment.

### Gaps
- No controlled evidence separating annual plans' causal effect from the selection of already-committed buyers.
- I found no monthly churn benchmark specific to creator or video web tools. Category-level data is mobile only.
- Recurly data surfaced with conflicting secondary figures, so I did not use it.

## Which free-tier designs protect margin, what evidence exists, and how do products stop multi-account abuse?

### Takeaway
The strongest evidence is for *who* gets compute: requiring a card concentrates compute on likely payers. For watermarks, queue priority and retention limits, I found no published controlled evidence. They are common practice, and recommendations about them are judgment.

### Cited Findings

**What competitors actually do**
- Descript free: 60 media minutes per month, **100 AI credits as a one-time grant**, 720p, watermark, no top-ups. Paid: $16 or $24 Hobbyist, $24 or $35 Creator, $50 or $65 Business, with minutes and credits both metered (the lower figure is most likely the annual rate). — [Descript pricing](https://www.descript.com/pricing) (opened Nov 2026)
- OpusClip free: "free clips every month", media expires after 3 days, MP4 export limit of 3 days, animated caption templates with watermark, no watermark-free export. Starter $15 (29-day storage), Pro $29. — [OpusClip pricing](https://www.opus.pro/pricing) (opened Nov 2026)
- OpusClip credit details on third-party blogs conflict (monthly 60 minutes vs one-time 90 minutes). — [Castmagic](https://www.castmagic.io/blog/opus-clip-alternatives); [Marc Andrews](https://marcandrews.com/opus-clip-free-plan-2026-what-you-actually-get-for-free/) (snippets; affiliate-style blogs)
- Submagic: blogs disagree on free trial vs recurring 3 videos per month; watermark either way. — [Typito](https://typito.com/blog/submagic-alternative-submagic-ai-review/); [Fluxnote](https://fluxnote.io/guides/free-submagic-alternative-2026) (snippets; competitors). CapCut: sources conflict on watermark. Verify on vendor pages before citing any of these.

**Evidence by design pattern**

| Pattern | Evidence found | Strength | Source |
|---|---|---|---|
| Card-required trial | 30% vs 8% signup-to-paid; 35 vs 45 signups per 1,000 visitors; 10.5 vs 3.6 payers. First Page Sage: 49.1% vs 17.3%, visitor-to-paid about equal | Moderate; survey and agency data, mostly B2B; signup loss is real | [ChartMogul](https://chartmogul.com/reports/saas-conversion-report/); [First Page Sage](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/) |
| Hard paywall vs freemium, mobile | 10.7% vs 2.1%; day-60 revenue per install $3.09 vs $0.38; year-one retention nearly identical | Moderate; large data; heavy selection effects | [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/) |
| Freemium and trials vs no trial, AI apps | Freemium +11.4 pts and 7-day trial +12.7 pts among high retainers; no trial +23.7 pts among low retainers; hard paywalls under 2% of apps | Correlation only | [RevenueCat AI study](https://www.revenuecat.com/blog/growth/ai-app-retention-study) |
| Generation limits inside a trial | RevenueCat advises capping generations to control trial cost, with no measured effect given | Advice | [RevenueCat AI study](https://www.revenuecat.com/blog/growth/ai-app-retention-study) |
| Trial length | 4 days or less 25.5%; 5-9 days 37.4%; 17-32 days 42.5%. 68.2% of Photo & Video trials are 4 days or less | Correlation; mobile | [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/) |
| Ungated use before signup | Good 7-9%; 38% of freemium products allow it | Survey; high abuse risk with compute | [ChartMogul](https://chartmogul.com/reports/saas-conversion-report/); [Growth Unhinged](https://www.growthunhinged.com/p/free-to-paid-conversion-report) |
| Reverse trial | Good 4-6%, great 8-12%; small sample, not statistically significant | Weak | [ChartMogul](https://chartmogul.com/reports/saas-conversion-report/) |
| Watermark | No controlled test found. Claims that it drives upgrades, or hurts reach, come from competitors selling no-watermark tools | None | [Fluxnote](https://fluxnote.io/guides/fluxnote-watermark-policy) (snippet) |
| Monthly vs lifetime allowance | No test found. Descript mixes both | Practice only | [Descript](https://www.descript.com/pricing) |
| Retention limit | No test found. OpusClip 3 days free vs 29 days Starter | Practice only | [OpusClip](https://www.opus.pro/pricing) |
| Export or duration limits | No test found | Practice only | [Descript](https://www.descript.com/pricing); [OpusClip](https://www.opus.pro/pricing) |
| Queue priority | I did not find evidence and ran no dedicated search | Unknown | n/a |

**Multi-account abuse**
- Stripe recommends layered signup risk scoring: device fingerprint, email domain reputation, IP and ASN velocity, browser integrity, then payment or phone verification only where justified. Rollout order: bot detection, disposable-email blocking, device fingerprint, and last progressive verification and payment requirement. It also suggests gating costly features behind a payment method. — [Stripe guide](https://stripe.com/resources/more/how-to-prevent-free-trial-abuse-in-saas-and-ai-products) (snippet; vendor)
- Stytch describes blocking or stepping up (SMS, card) on repeat device IDs. — [Stytch](https://stytch.com/docs/fraud/guides/prevent-free-trial-abuse) (snippet; vendor)
- Stripe notes that any blocker may also stop genuine users. — [Stripe guide](https://stripe.com/resources/more/how-to-prevent-free-trial-abuse-in-saas-and-ai-products) (snippet)

### Inferences
Recommended free tier for a compute-heavy video tool (Judgment):

1. **Small, one-time compute grant at signup, then a very small monthly refill.** A lifetime grant caps the worst case; a small refill keeps the long-tail converter (23% of mobile freemium conversions come after week 6) from being lost entirely. Size it with the rule above (conversion x LTV / 3), and show it in minutes.
2. **Cap duration per job.** The cost per video stops being open-ended. A full finished result on short clips still shows the value.
3. **Spend compute after intent, not before.** Delay the costliest steps (final render) until the user has seen a cheap preview. This is architecture-dependent; a browser-side preview costs nearly nothing compared with a server render.
4. **Watermark on free export.** Costs nothing in compute and blocks professional use of the free tier. For a tool aimed at paying professionals, its acquisition value is unproven; test it, and do not count on virality.
5. **Short retention of free media (for example 3-7 days).** It directly cuts storage cost and has a working precedent at OpusClip.
6. **Lower queue priority for free users.** Protects paid-user latency. No evidence on conversion; treat it as an operational control, not a growth lever.
7. **Test a card-required trial as a second path.** On ChartMogul's numbers, one payer takes 18 free signups (Calc: 1 / 5.5%) on freemium vs 3.3 on card-required (1 / 30%). When every user costs compute, this matters more than for classic SaaS. It may not transfer cleanly to Thailand, where card ownership may be lower; I did not check this.
8. **Abuse controls in Stripe's order.** Stop at the lightest layer that works. Tie the compute grant, rather than the account, to a verified signal such as a phone number or a duplicate-upload check. Check this against the privacy policy before collecting device signals. Set a global daily spend ceiling on free compute as a final backstop, so that an abuse wave costs a known maximum.

### Gaps
- No controlled public data on watermark effects, retention limits, queue priority or duration limits. Results were mostly affiliate blogs or competitors.
- No measured abuse rates for AI video tools.
- ChartMogul's segment "good/great" figures partly come from chart descriptions in a text extraction, so verify visually before quoting in a formal document.
- Note that ChartMogul's funnel example (5.5% freemium) is an example for its calculation and not the same as its segment bands.

## Which value metric and plan structure, and are founding-member or lifetime deals safe?

### Takeaway
Judgment: use a flat monthly subscription that includes a clear number of minutes, a hard cap with no surprise overage, and optional top-ups. Internal credits may be fine, but show users minutes. Good/better/best is standard, while the evidence for decoys and highlighted plans in SaaS is weak. Avoid unlimited lifetime deals on compute.

### Cited Findings

**Credit vs predictable pricing**
- Buyers see credit pricing as hard to predict and a "black box", and buyer acceptance is the main barrier. No buyer survey is presented. — [Growth Unhinged, Sep 2025](https://kylepoyar.substack.com/p/ai-credit-pricing)
- Adoption is nonetheless wide: Adobe, Asana, HubSpot, Lovable, Replit, Microsoft, Salesforce, OpenAI enterprise and others. — [Growth Unhinged](https://kylepoyar.substack.com/p/ai-credit-pricing)
- Cursor case (June-July 2025): moved $20 Pro from request limits to a monthly pool. It then publicly said: "Our recent pricing changes for individual plans were not communicated clearly", apologized, offered refunds for unexpected charges from 16 June to 4 July, and added a spend limit, dashboard usage visibility and a promise of advance notice. — [Cursor](https://cursor.com/blog/june-2025-pricing) (opened; primary)
- The anger was reported as centering on rollout and on "unlimited" vs capped confusion more than on price itself. — [Fintech Weekly](https://www.fintechweekly.com/news/cursor-pricing-change-user-backlash-refund) (snippet)
- Hybrid monetization (subscription plus consumables) leans 16.3 points toward *low*-retention AI apps; subscription-only leans 16.4 toward high. However, about a quarter of the best retainers sell consumables. Correlation only. — [RevenueCat study](https://www.revenuecat.com/blog/growth/ai-app-retention-study)
- Metric mix in AI apps, 2024: about seven in ten use subscriptions, very few pure pay-as-you-go, most per-user. About half offer a free plan and about one in five a free trial; about two in three publish prices. Good/better/best is common. — [Growth Unhinged, 40 AI startups, May 2024](https://www.growthunhinged.com/p/how-ai-apps-make-money?open=false) (opened in part)
- Direct video comparison: Descript meters both minutes and credits. OpusClip's credit is reported as one minute of source video. — [Descript](https://www.descript.com/pricing); [third-party blog](https://www.castmagic.io/es/blog/opus-clip-pricing) (snippet; attribution to this exact page not confirmed)

**Anchoring, decoys, highlighted plan**
- Academic decoy research: the original 1982 demonstration is real, but large replications in 2014 failed under realistic stimuli. The original authors themselves replied that the effect demonstrates a theoretical violation, not a marketing tool. — [Huber, Payne & Puto 2014](https://people.duke.edu/~jch8/bio/Papers/HuberPaynePutoJMR%202014.pdf) (snippet)
- Widely repeated SaaS lifts for decoys (for example, 30-50% more selection of the target plan) were given without study, sample or method in practitioner blogs. — [Atticus Li on Medium](https://medium.com/@atticusli/the-decoy-effect-in-plan-selection-how-a-third-option-changes-everything-0f5cc35eeff0) (snippet; attribution of that exact claim to this page not confirmed; do not quote)

**Lifetime and founding deals**
- Yapper, an AI video tool, sold lifetime access on AppSumo. Its founder's reply: "the cost to generate videos wasn't dropping fast enough to offset the volume from Sumo-lings"; it moved to one-time lifetime credits and offered refunds. A reviewer called it a "dumpster fire" and alleged about 10x normal credit use. — [AppSumo review thread](https://appsumo.com/products/yapper/reviews/a-big-loss-was-on-its-way-to-be-a-win-369285) (opened; anecdote, but the closest case found)
- Mootion's fix was monthly credit caps inside its lifetime tiers. — [AppSumo blog](https://appsumo.com/blog/mootion) (snippet; marketplace marketing)
- AppSumo's CEO is reported saying "we need to evolve with the market of AI costs", and to be testing credits, bundles and recurring deals. The same article reports revenue down 50% over two years (not independently verified). — [PPC Land](https://ppc.land/appsumos-revenue-crashes-50-as-lifetime-deal-model-faces-existential-crisis/) (snippet)
- Poyar: AI costs have not fallen as fast as some forecast; newer models stay expensive. — [Growth Unhinged](https://kylepoyar.substack.com/p/ai-credit-pricing)

### Inferences
- **Value metric (Judgment).** Minutes of finished or processed video is close to how a creator thinks about work and is a natural unit of cost. Keep the unit visible and simple, show remaining balance, warn before running out, and do not charge overage automatically. Seats are a poor fit for solo creators. Plain "unlimited" repeats the Cursor problem, and given 70-80% of use from 10% of users, it invites the heavy users you least want.
- **Plan structure (Judgment).** Offer three clear plans with real uses for each, and highlight one because that's clear, not because of a claimed lift. Do not add a fake decoy plan for a claimed percentage. Judge pricing tests by revenue per visitor, including annual mix. With little traffic, a new product cannot run meaningful price A/B tests anyway, so use cohort comparisons.
- **Founding-member offer (Judgment).** Never sell unlimited lifetime access. A safe form: a founding price held while the subscription stays active (or for 12-24 months), a monthly minute cap, a limit on number of seats sold, and terms that say the price covers an included allowance. If a one-time payment is wanted for cash, sell a prepaid pack of minutes. Lifetime money arrives once while compute costs recur, so the deal has a growing liability and tends to select for heavy users.
- Change-communication rule from Cursor: announce, explain in concrete numbers, and offer a refund path before a plan change, not after.

### Gaps
- No independent buyer survey on credit vs minutes vs flat preference for creator tools.
- A "126% year-over-year growth in credit pricing" figure attributed to Poyar's 2025 survey appeared secondhand in search only; I could not verify it on his own page, so it is not used.
- No credible published SaaS field experiment on highlighted plans.
- A practitioner anecdote of a test that lifted trial conversion by 31%, cut annual selection by 52% and dropped revenue per visitor by 18% appeared in search; I could not attribute it to a specific checked page, so treat it only as an illustration of the metric trap.
- The 2014 JMR replication papers were not opened directly. Follow-ups reportedly recover some effects, so the debate is unresolved.
- I found no measured default rates or shutdown rates for lifetime deals; numbers in circulation (30%, 40%) are from unverified blogs.

## Does purchasing-power pricing raise revenue, how is it implemented, and how is abuse prevented?

### Takeaway
Local *currency* has reasonable evidence of a modest lift. Discounted *PPP pricing* has almost no independently verifiable evidence, and for a compute product the discount comes straight out of margin. Judgment: show Thai baht and local payment methods first. Discount only with reduced allowances or after modeling break-even.

### Cited Findings
- Stripe's randomized holdback test (1% holdback; about 1.5M subscription checkout sessions): signup conversion +4.7%, authorization +1.9%, LTV per session +5.4%, some businesses above 30%. Runway's LTV per session was +14%. Over-time metrics cover only the first 3 months. This tests **FX display only, not discounted pricing**. — [Stripe, 19 Mar 2026](https://stripe.com/blog/adaptive-pricing-for-subscriptions) (opened; vendor selling the product; no confidence intervals reported)
- Geography matters on mobile. Trial-to-paid: North America 34.2%, Asia-Pacific 31.9%, Western Europe 29.7%, India/SE Asia 15.2%. Day-60 revenue per install $0.55 in North America vs $0.11 in India/SE Asia. Yearly realized LTV: Western Europe $26.64 vs India/SE Asia $19.32. Download-to-paid in India/SE Asia lowest, with the page giving both 1.4% and 0.7%. — [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/) (opened; aggregate, not Thailand)
- Local payment methods: Stripe reports businesses offering UPI see 19.8% higher conversion from India. A payment-method finding, not a price one, and India rather than Thailand. — [Stripe guide](https://stripe.com/guides/how-local-pricing-affects-subscription-conversion-for-media-entertainment-and-gaming) (snippet; page attribution not confirmed)
- A secondary blog says PPP-aligned pricing lifts conversion 15-40% in low-income markets "per RevenueCat", yet the same article restates 15-40% as a share of revenue, and it says it is unaffiliated commentary. — [AppsOps, May 2026](https://appsops.store/blog/revenuecat-data-local-pricing) (opened). I did not find this figure on RevenueCat's page. **Do not use.**
- Fungies reports an anonymized case of 4x monthly revenue in two markets. — [Fungies](https://fungies.io/ppp-pricing-saas-boost-global-revenue-2026) (snippet; vendor; attribution to exact page not confirmed)
- Implementation: use IP geolocation as a first check, then at checkout compare billing address and card country; use a separate price list by region; calculate tax by verified location; consider regional plans with different limits. Enforcement options: strict block when countries disagree, soft redirect, or terms of service. Restricting a price to locally issued cards or local payment methods is described as among the most effective controls. VPN abuse is named but no method is described. No measured results are given. — [Kinde](https://kinde.com/learn/billing/optimization-and-revenue/localized-and-ppp-pricing/) (opened; vendor)
- Stripo's research explicitly says it could not source a widely quoted "45% increase" attributed to Stripe. — [Stripo](https://research.stripo.email/saas-pricing-analysis) (snippet). This is a useful warning about how figures in this area circulate.

### Inferences
- **Break-even math (Calc; invented inputs).** At $15 list with $6 of compute and payment cost, margin is $9. A 40% discount gives a $9 price and $3 margin, because compute is priced in dollars no matter where the user is. Conversions must therefore **triple** to break even (formula: (P - C) / (P(1 - d) - C)). The same discount on an 85%-margin SaaS needs only about 1.9x (Calc: $12.75 / $6.75). PPP advice written for classic SaaS therefore overstates the case for a compute product.
- **Recommended approach (Judgment).**
  1. Show baht prices and local payment methods (for example PromptPay, if the payment provider supports it) before any discount.
  2. If you discount, sell a local plan with fewer included minutes so margin per minute holds, rather than the global plan at a lower price.
  3. Tie the local price to a locally issued card or local payment method, since the VPN-resistant signal is the payment instrument rather than IP.
  4. For a Thailand-first product, Thailand is the home market rather than a discount market. Set the base price for that market and treat the US price as the higher tier.
- Expect lower conversion and revenue per user in Thailand than US-based benchmarks suggest, based on India/SE Asia data. This supports keeping base at 3% rather than higher. Thai-specific conversion remains unknown.

### Gaps
- No independently verified, named before-and-after case on discounted PPP pricing. Figures such as "4.7x conversion", "30% revenue increase" and "25% higher revenue per customer" appeared only in vendor blogs quoting ProfitWell or OpenView without a traceable primary source, so I do not recommend using them.
- No Thailand-specific data on subscription conversion, willingness to pay, or card vs PromptPay effect.
- Named searches on ParityDeals, Wes Bos, Sublime, Notion and Spotify returned no results I could use.
- No measured rate of PPP abuse. One vendor article reports "negligible evidence" of abuse without data.
