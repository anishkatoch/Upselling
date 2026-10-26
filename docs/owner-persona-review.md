# SalesIQ: owner-persona product review (2026-10-26)

Scope: the OWNER of a Saudi sales business, three client demos coming. Read-only review; no source edited.
Evidence levels: **L1** read code, **L3** seen in the running app, **L4** drove a defined flow. Anything marked **ASSUMED** is a fact about owners I cannot know. Simulated owners are **hypotheses, not research**.
Already known issues are referenced, not repeated: `saudi-poc-review.md` gaps 1-9 (call them **R1-R9**) and the "Not verified / known gaps" list in `saudi-demo-data.md` (**D**).

How the app was seen: sample Saudi store (`LOCAL_STORAGE_DIR=sample_data/store`) on my own temporary server (port 8766, now stopped), because the shared server on 8765 holds three TTS test jobs with no salesperson names (dashboard shows "No data", see gap G9). Desktop 1280 wide, plus 375 wide for the dashboard. Pages opened: Dashboard, Team, Person (Khalid, week and month), Conversations list, one recording with all six tabs. Not opened: Reem/other person pages, login/signup, user menu, the record dialog's flow (see NOT VERIFIED).

## Verdict in one paragraph

The product already answers "what happened in this conversation" very well: the recording page (Summary, Outcomes, Evidence) names the pushy moment, quotes the line, and writes the coaching sentence (L3). It does **not** yet answer the owner's real top-level questions: "who is my best/worst salesperson", "who treats customers badly", "what money did I lose". The dashboard and team table say **6 of 6 salespeople are "Excelling" and the team mood is "Calm"**, while the same data contains a pushy salesman whose customer walked out (L3). In a demo, an owner will see that contradiction in the first 20 seconds. The fix is mostly surfacing and ranking what the pipeline already computes, not new analysis.

---

## 1. Owner jobs-to-be-done

All of this section is **ASSUMED** (no owner interviews were available) except where code is cited.

**Who:** owner or GM of a Saudi retail/sales business (electronics, cars, perfume, telecom, appliances). 3 to 30 salespeople, one to several sites. Often an Arabic-first owner with English-speaking expat staff (the demo data mirrors this: Imran, Mohammed).

| Job | Trigger | Current workaround (ASSUMED) | Frequency | A good week looks like |
|---|---|---|---|---|
| J1 Know who is selling well | Monthly targets, bonus time, "who do I promote / send to the new branch" | Sales totals from the till or CRM; gut feel; asking the branch manager | Weekly glance, monthly decision | One ranked list I trust enough to quote in a bonus conversation |
| J2 Catch bad treatment of customers | A customer complaint, a bad Google review, a customer calling the owner directly | Mystery shopper (rare), CCTV (no audio), waiting for complaints | On trigger, but wants early warning daily | No complaint reaches me before the system told me |
| J3 Find lost revenue | Slow month, "why are accessories attach rates low" | Compare category sales, ask staff | Weekly | Knowing which customers left with nothing extra and why |
| J4 Decide who to coach, and with what | Weekly staff meeting; new hire (Saudization hiring adds new staff, see R-notes in `saudi-poc-review.md`) | Manager shadows the floor | Weekly | One named person, one concrete behaviour, one example I can play to them |
| J5 See the trend | "Is the training I paid for working" | Nothing | Monthly | An arrow per person and for the team that moves because of what I did |
| J6 Keep staff trust | Staff hear "recordings" and fear a spy tool | Verbal promises | Once, at rollout, and on every complaint | Staff see their own page and their own good moments; nobody is surprised |

**The 5 questions the owner asks every time they open it** (hypothesis):
1. Is anything on fire? (a customer treated badly, a pushy salesperson this week)
2. Who is my best and who is my worst right now?
3. Where am I losing money? (customers who wanted more and were not offered; offers wasted by pushing)
4. Who do I talk to today, and about what exactly?
5. Is the team getting better than last month?

Question 1 and 3 are not answered on the first screen today. Question 2 is answered wrongly (everyone is "Excelling"). Question 4 needs 3 clicks. Question 5 shows only when 3+ months of data exist (the trend chart is hidden below that: `Dashboard.tsx` `orgTrend.length > 2`, L1).

---

## 2. Element-by-element table

Verdicts: KEEP / RENAME / MOVE / REMOVE / ADD. "Q" = owner question number from section 1.

### Dashboard (`/`)

| Element | What it is | Q | Verdict | Reason | Evidence |
|---|---|---|---|---|---|
| Hero "How your team is doing and who needs you." | Page subtitle | - | KEEP | Right promise. The page then fails to deliver "who needs you" (see Attention). | L3 |
| "Arrows show the change compared with last month." | Note above tiles | 5 | KEEP, MOVE | Only appears when two months exist. Fine, but it is above the tiles and nothing explains arrow colour for "lower is better". | L1 |
| Tile: Customer mood (Calm) | Team mean of worst-moment frustration, as a word | 1 | RENAME + CHANGE | Reads "Calm" while a customer left angry in the same data. Averaging hides the one moment the owner cares about. Show "2 calls needed attention this month" as the headline. | L3 |
| Tile: Greets customers (86%) | Share of solo conversations with a greeting | 4 | MOVE | True and cheap to coach, but it is a hygiene metric, not an owner outcome. Move below the fold or into Team. | L3 |
| Tile: Questions left unanswered (5) | Count | 3 | KEEP | Concrete, countable, ties to lost sales. Add "in N conversations" and a link to the list. | L3 |
| Tile: Tries to upsell (75%) | Share of conversations with an offer | 3 | KEEP | Owner understands "do they offer". Pair it with the yes rate. | L3 |
| Tile: Customers say yes (43%) | Accepted / decided offers | 3 | KEEP | The closest thing to a revenue signal. Disagrees with the funnel "39% said yes" (different denominator), see G10. | L3 |
| "i" info buttons (5) | One-line definitions from `metricInfo.ts` | all | KEEP | Plain wording, good for a non-technical owner. | L1/L3 |
| Count-up animation on tiles | `AnimatedNumber` counts from 0 | all | REMOVE | Caught mid-count in two screenshots: "1%/0%" at first look, "11%/10%/6%" on a 375 px screen after a 3 s wait, final values 86/75/43. A phone glance or a screenshot in a WhatsApp forward shows wrong numbers. This is the likely cause of R5; D says only the Person page was fixed. | L3 |
| Rating counts strip (Needs support / On track / Excelling / Not rated, each a link) | 4 counters linking to filtered Team | 2, 4 | KEEP, FIX | Good idea, but 0/3/3/0 here and 0/0/6/0 in Team (week), so it carries no information. See G1. | L3 |
| Card: "Needs your attention" | Lists people rated "needs_work" | 1, 4 | CHANGE | Said "Nobody needs support right now" although a pushy upsell with a lost customer exists in the data (Khalid 14 Oct, per D). It is driven only by the rating, never by flags. This is the single most important card on the page. | L3 + L1 (`Attention.tsx`) |
| Card: "Doing well" | Top 3 "strong" by lowest worst-mood, reason = first strength | 2 | RENAME | Lists Khalid (83% greeting reason) as "doing well". Name it "Top performers" only once a real ranking exists. | L3 |
| Card: "How customers felt ✦ AI" donut | Went well / Okay / Needs attention counts | 1 | KEEP | The only place that shows a count of bad calls (2). Clickable? It is not; make "Needs attention 2" open those calls. Page text glues "14" and "39%" ("1439%") for assistive tech; check markup. | L3 |
| Card: "How each conversation ended" bars per salesperson | Yes / no / no upsell offered per person | 2, 3 | KEEP, MOVE UP | This is the closest thing to a ranking and it is the second-best chart. It is buried under the attention cards. Make it the team scoreboard. | L3 |
| Section "Upselling": funnel (36 to 27 to 14) | Conversation to offer to yes | 3 | KEEP | The "lost revenue" story in one picture. Add "13 conversations with no offer" as a clickable gap. | L3 |
| Card: "Which approaches get a yes" | Technique success rates (bundle 57% etc.) | 4 | KEEP, MOVE to Team/coaching | Valuable for coaching decks, not an opening-screen question. Small samples (4 of 7) and the "too few to compare" note are honest. | L3 |
| Chart: "How often they try to upsell, over time" | Team trend by month | 5 | KEEP, ADD data | Hidden with under 3 months of data, so in the demo the trend question has no answer (L1: `orgTrend.length > 2`). Show a week-by-week line from day one. | L1 |
| "Start recording" button (top bar) | Opens recorder dialog | - | KEEP | Good for a live demo ("record yourself pitching"). Owners do not record; salespeople or managers do. | L3 |
| Dashboard defaults to MONTH, Team defaults to WEEK | Period inconsistency | 5 | CHANGE | Dashboard links to `/team?period=month` but top nav "Team" opens the week view where all 6 are Excelling (`Team.tsx`). An owner sees different truths on two clicks. | L1/L3 |

### Team (`/team`)

| Element | What it is | Q | Verdict | Reason | Evidence |
|---|---|---|---|---|---|
| Title "Your team" + "How each salesperson did this week." | Header | 2 | KEEP | | L3 |
| Daily / Weekly / Monthly toggle | Period | 5 | KEEP | Default is Weekly while the dashboard is Monthly; pick one. | L3 |
| "6 salespersons · 12 completed recordings · grouped by when each recording was made" | Meta line | - | RENAME | "salespersons" is not English; "6 salespeople". Second half is system talk. | L3 |
| Filter chips (Everyone / Needs support / On track / Excelling / Not rated) | Rating filter | 2, 4 | KEEP, FIX | Useless while ratings do not separate people (all 6 "Excelling"). | L3 |
| Column: Rating | strong/solid/needs_work | 2 | CHANGE | Every person is "Excelling", including: 0% accepted (Khalid weekly), 33% (Reem), pushy upsell and irritated customer in his month. Cause: rating = points over available points, strong at 75% or more (`dashboard.py:550-554`), and the heaviest weight is on greeting/listening/mood where this data scores high (L1). Known in D; owner impact is that no ranking exists. | L3 + L1 |
| Column: Greets customers | % | 4 | MOVE/REMOVE from default view | 5 of 6 are 100%, no differentiation. Keep in Person page. | L3 |
| Column: Customer mood (Calm for everyone) | Word | 1, 2 | CHANGE | No variance, same averaging problem as the dashboard tile. Replace with "Bad calls: n". | L3 |
| Column: Tries to upsell, with "▲ 33 points" | % and delta | 3, 5 | KEEP | Deltas are the most "owner-readable" thing here. Delta "▲ 100 points" for Mohammed (0 to 100%) on 3 conversations is a small-sample trap (G6). | L3 |
| Column: Customers say yes | % and delta | 2, 3 | KEEP, make default sort | Closest to "who sells". Khalid 0%, Noura 100%: this sorted descending would be the demo's money shot. Sort exists in code (name, rating, upsell, accepted) but the default is rating. | L1/L3 |
| Column: Selling effort (Moderate/Low) | Word from `effort_score` | 4 | RENAME | "Effort" reads as a judgement on hard work and staff will resent it. It is really "offers per customer, persistence". Name it "Offer activity". Info text uses "how hard the salesperson works". | L3 |
| Column: Trend (Steady/Improving) | Effort trend word | 5 | KEEP, RENAME | It tracks effort, not results; "Improving" next to 0% yes confuses. Label "Offer activity trend" or base on yes rate. | L3 |
| Sub-line "3 conversations" under the name | Sample size | fairness | KEEP | The only fairness signal; make it visible as a small-sample warning (under 5) instead of plain text. | L3 |
| "Arrows show the change compared with the previous period." | Footnote | 5 | KEEP | | L3 |
| Row click opens Person | Navigation | 4 | KEEP | | L3 |

### Person (`/team/:name`)

| Element | What it is | Q | Verdict | Reason | Evidence |
|---|---|---|---|---|---|
| Header: name, "1 recording · 3 customer conversations · this week", Improving, Excelling badges | Identity + status | 2, 4 | KEEP | "Excelling" badge contradicts the "To work on" list in the month view. | L3 |
| Period toggle | Day/Week/Month | 5 | KEEP, FIX | Person page starts at Week and ignores `?period=month` in the URL (state initialised to "week", `Person.tsx:30`), so the dashboard's "month" context is lost on click-through. | L1/L3 |
| Banner "No conversations this week, so this shows the week of 19 Oct 2026 instead." | Fallback notice | - | RENAME | Honest but jargon-like; demo data is "old" relative to today (2026-10-26). Prefer "Latest data: week of 19 Oct". | L3 |
| Headline "Excelling across the board" + "Based on 3 conversations" | Summary sentence | 2 | CHANGE | "Across the board" is false for Khalid (month view shows 11% accept, 3 repeated offers). Wording should come from flags, not the points rule. | L3 |
| 4 tiles (Greets, Mood, Tries to upsell, Customers say yes) with deltas | KPIs | 2, 5 | KEEP | Good. Mood tile for Khalid month shows "Calm" with sub-line "Worst conversation: frustrated (6/10)" which is the right fact in the wrong size. Promote the sub-line, drop "Calm". | L3 |
| 4 tiles (Selling effort, Offers per conversation, Different approaches, Offers repeated after a 'no') | Effort breakdown | 1, 4 | KEEP/RENAME | "Offers repeated after a 'no'" is the pushiness measure; it is the owner's J2 metric and sits fourth in a grey row. Make it a headline "Pushy after a no: 1 conversation". | L3 |
| Card "Compared with the team" bars | Person vs team average | 2 | KEEP | Strongest fairness-by-design element. "Team: 60%" (weekly) vs the dashboard's 43% and "Team: 52%" (monthly): team figure is the average of 6 people, not the pooled rate (stated in a footnote). Owner will see 3 different "team yes rates". | L3 |
| Card "How their customers felt ✦ AI" | Donut | 1 | KEEP | Duplicate of the dashboard card at person scope; fine. Number "1 calls" label shows participating call count wrongly when 3 conversations (donut centre "1 calls" vs 3 okay): mid-animation, L3 not confirmed. | L3 |
| "Doing well" list ("+4 more") | Strengths | 4 | KEEP | Good raw material for a praise message. "+4 more" is a dead end (not expandable?). Not clicked. | L3 |
| "To work on" list | Improvements | 4 | KEEP, MOVE UP | This is the actual coaching answer, and the best text in the product ("Kept pitching after a clear 'no' in 1 of 6 conversations - ..."). It sits below the fold. In the week view it says "Nothing urgent - keep it up." | L3 |
| "Upselling (optional)" tip | Upsell advice | 3 | KEEP | The "optional" framing suits Saudi service culture (R-note on coaching framing). | L3 |
| Recent conversations list (date, title, mood, outcome, offered/said yes) | Links to recordings | 1, 4 | KEEP | Best navigation in the app: title + outcome in one line. Missing: a red flag icon for pushy/bad. "Show all 6" fine. | L3 |
| "Recent coaching ✦ AI" | Coaching notes from the last recordings | 4 | KEEP, RENAME | Notes are generic and read as if for another person ("phone pairing help", "Ask about existing insurance" on a car salesman; text could be about conversations not Khalid's worst). Show coaching for the flagged conversation first and name which conversation each note belongs to. | L3 |
| Disclaimer "AI-generated and indicative - check the evidence..." | Trust note | 6 | KEEP | Right tone for staff-trust (J6). | L3 |

### Conversations list (`/recordings`)

| Element | What it is | Q | Verdict | Reason | Evidence |
|---|---|---|---|---|---|
| Title "Every conversation, and what we found." | Header | 1 | KEEP | Promises "what we found"; the table shows none. | L3 |
| Table: avatar initials, name, date+time, status "Ready" | Index of recordings | 1 | ADD columns | No verdict, no flag, no outcome, no filter, no search. All 12 rows look identical, so the owner cannot find the bad call without opening six. Add: conversations, "pushy / unhappy" flag, yes/no outcome, sort by flag. | L3 |
| Time "16:00" for recordings created 10:30 UTC | Timestamp | - | CHECK | Likely browser timezone; owner in Riyadh (UTC+3) should see 13:30. Not verified which timezone the UI uses. | L3 (value), unverified (cause) |
| Status "Ready" | Pipeline state | - | KEEP | Needed for uploads, but for owners it is noise once everything is Ready; show only when not Ready. | L3 |

### Recording page (`/recordings/:id`)

| Element | What it is | Q | Verdict | Reason | Evidence |
|---|---|---|---|---|---|
| Header card: "Shift recording", duration, "4 voices", "3 sales conversations", status | Context | 1 | KEEP | "4 voices" is engineering language; "3 customers". | L3 |
| Tab bar: Overview, Summary, Outcomes, Evidence (11), Conversations (3), Full transcript | 6 tabs | 1, 4 | CHANGE | Six tabs for one recording. Summary, Outcomes, Evidence and Conversations repeat the same pushy moment in four layouts (L3: the "4 offers, three after a no" story appears in Summary, Outcomes, Evidence and Conversations). Collapse to Summary (default), Details, Transcript. Land on **Summary**, not Overview. | L3 |
| Overview: 6 tiles (sales conversations, tried to upsell 67%, offers 6, greeted 67%, unanswered 0, frustration 2.0/10) | Recording-level KPIs | 1 | MOVE | A KPI strip about a single shift is meaningless to an owner; the headline is "2 need attention". | L3 |
| Overview: "Salespeople" table (greeted, unanswered, Pushy after a "no" = 1, worst mood Frustrated 6/10) | Per-person row | 1, 2 | KEEP | **The only place in the product where pushy appears as a number** (grep L1). Surface it on Team and Dashboard. | L1/L3 |
| Overview: "Who spoke" table (role, share-of-talking bar, talk time) | Diarization output | - | REMOVE from owner view | Talk share is an engineering/coaching detail. The roles ("Car sales advisor (Dammam)", "Family car buyer") are nice but the bar and seconds do not answer an owner question. Keep as expandable "Speakers" in Details. | L3 |
| Summary: counters "2 need attention / 1 worth a look / 1 of 3 greeted & not pushy" | Triage | 1 | KEEP, MOVE to top of product | This is the owner's first screen, mislabelled as a tab. | L3 |
| Summary: "Points to note" with View conversation links | Flags with reason | 1, 4 | KEEP | Best element in the app. Wording is usable verbatim in a staff chat ("Four offers in ten turns; three came after a clear 'no'..."). | L3 |
| Summary: Conversation summaries with Coaching text | Per-conversation narrative + advice | 4 | KEEP | Strong. Add the salesperson-friendly version ("what to say next time"). | L3 |
| Outcomes tab: Positive calls / Negative calls / Upsells won / lost / "Offers accepted 1 of 6" | Counters | 3 | KEEP | The "1 of 6" is an owner-grade number. | L3 |
| Outcomes: "What each salesperson tried to sell" table with SAR offer text and "success 17%" | Offer ledger | 3 | KEEP, ADD | The only place SAR amounts appear (inside free text, not summed). Add "offered SAR 22,550, accepted SAR 650" (G2). | L3 |
| Outcomes: "Every call" list with Arabic quotes and "after a 'no'" tags | Per-call offers | 4 | KEEP | The "after a no" tag is the best pushy evidence. | L3 |
| Evidence (11) tab: filters (Person, Type), "Expand all", cards per upsell/frustration/greeting/feedback | Raw findings | - | MOVE to Details / REMOVE as top-level tab | Auditors want it; owners do not. Valuable for trust (every claim has a source), so keep reachable but not a peer tab. | L3 |
| Conversations tab: Jump to, per-conversation What happened / Key moments / How the customer felt / Coaching, "Offers we did not count (1)" | Narrative per conversation | 4 | KEEP, merge with Summary | Most complete single view; merge Summary and this. "Offers we did not count" is unexplained to an owner; rename "Not counted as upsell". | L3 |
| "Salesperson: Khalid Al-Dosari - spoken in Other" | Language label | - | CHANGE | "Other" for Arabic is embarrassing in a Saudi demo (D: `Language` enum has no Arabic). Show "Arabic". | L3 |
| Arabic quotes shown without English | Evidence quotes | 4 | ADD | A bilingual owner or an English-speaking branch manager cannot read them. Add a one-line English gloss under each quote (the AI already writes an English summary). | L3 |
| Full transcript: filters (All / Upsell attempts / Frustration), Copy, Download .txt, legend "salesperson on the right" | Transcript view | 4 | KEEP | Right controls. Highlight tags ("Upsell attempt · Offered an upgrade", "Frustration") are the evidence the owner needs. RTL layout gaps are known (R2/D). | L3 |
| Audio playback | Missing | 4 | ADD | R7. For the owner it is the "proof" moment; here it is the difference between "AI says" and "I heard it". Noted in G3, not repeated. | L1 |
| Chat tab/widget (`chat.tsx`) | Ask-a-question panel in code | 4 | NOT SEEN | Found in code (`pages/recording/chat.tsx`, `chatUtils.tsx`) but I did not see it in the UI on this recording. Unverified whether it is reachable. | L1 only |

### Top bar and global

| Element | Verdict | Reason | Evidence |
|---|---|---|---|
| Nav: Dashboard / Team / Conversations | KEEP | Three items is right. Rename "Conversations" to "Calls" for sales owners? ASSUMED; keep. | L3 |
| "Start recording" pill | KEEP | See above. | L3 |
| "Demo User" + Log out | KEEP | Demo login and no role split (owner vs staff) is the privacy gap, see G7. | L1 (`auth.py`) |
| Mobile 375 px: nav collapses to icons; five tiles stack to ~900 px height before the attention cards | CHANGE | The "owner checks a phone for 2 minutes" person scrolls 3 screens to reach "who needs you". | L3 |

---

## 3. What the owner wants that the product does not show (gaps)

Ranked by demo impact. G-numbers are new; R/D are existing.

| # | Gap | Why the owner wants it | What exists already | Effort | Evidence |
|---|---|---|---|---|---|
| G1 | **A real ranking and ratings that separate people.** Today 6/6 are "Excelling", mood "Calm" for all (see also D: Khalid rating). | J1: "best and worst this month" | Per-person yes rate, upsell rate, delta, `sortValue` for upsell/accepted already coded in `TeamGlanceTable.tsx` | S-M | L3 |
| G2 | **Revenue and lost opportunity in SAR.** No money anywhere on any screen. | J3 | Offers are extracted with SAR in the offer text ("Mid trim at 96,000 SAR"; "Window tint only for 650 SAR") and `Outcomes` knows accepted/rejected, so offered vs accepted value is a sum over data that exists; not summed or shown. Whether amounts are reliably structured for real transcripts is unverified | M | L3 (text), L1 (fields) |
| G3 | **Hear the moment** (R7). Needed for demo trust more than any other single feature. Not repeated further. | J2 | API serves audio; sample Saudi data has none (D) | M | ref R7 |
| G4 | **Alerts for pushy or rude behaviour**: a flag on the first screen, per salesperson, count over time; also push to phone/WhatsApp. | J2 | `pushy_conversations` is computed per salesperson and per recording, shown only on the recording Overview table (L1 grep) | S (flag) / M (notification) | L1/L3 |
| G5 | **Per-person coaching action list for the owner**: "Talk to Khalid about: repeating offers after 'no' (14 Oct, #1)" with link and the English coaching sentence. | J4 | Text exists in recording summaries and Person "To work on" | S | L3 |
| G6 | **Fairness with small samples.** 3 conversations per person drive "▲ 100 points" and 100% yes, with no "too few to judge" mark on Team or Person (the Technique card has such a note; the people table does not). | Staff trust J6, sceptical owner | `insufficient_data` flag exists in `dashboard.py:80` | S | L1/L3 |
| G7 | **Privacy and staff view.** No staff-facing page, no "what the owner can see" statement, no role split (the demo account is a plain member; every user sees every recording, L1 `auth.py`), no consent step (R4). | J6 | None | M | L1 |
| G8 | **Trend from day one.** Org trend needs 3 months; per-person trend is the word "Improving" about effort. Owner wants weekly lines for yes rate, pushy count, bad calls. | J5 | Series exist per person (`p.series`) | S-M | L1/L3 |
| G9 | **Unassigned recordings are invisible.** API returns `unassigned` and `unassigned_conversations`; the frontend never reads them (grep). On the shared test server three completed Arabic jobs produce an empty "No data" dashboard (L3), so a real client who uploads without picking a name sees an empty product. | First real upload in the demo | Backend supports it | S | L1/L3 |
| G10 | **One definition of each number.** Yes rate shows 43% (dashboard tile, pooled), 39% (funnel, of conversations), "Team: 52%" (Person monthly, mean of people), "Team: 60%" (weekly). Owner quotes one to a manager and gets challenged. | Credibility | | S | L3 |
| G11 | Branch / team grouping. Multi-branch and 12-person owners cannot filter by site or manager. | Walkthroughs 2, 3, 4 below | `industry` is a job field; no branch | M | L1 |
| G12 | Customer-visible outcome that matters to owners: did the sale close? The product measures offers accepted, not whether a car was bought. Out of scope without POS integration; say so. | J3 | | L | ASSUMED |

---

## 4. Simulated owner walkthroughs

**All hypotheses, simulated by me; not research.** Format: first screen, first question, stuck point, what they say.

1. **Single electronics shop, 3 staff (owner-operator, Arabic first).** Opens the dashboard; first question "which of my boys is selling?". Sees team mood "Calm" and five tiles. Opens Team; all three are "Excelling" (as in the demo). Stuck: no ranking, nothing to decide. Says: "كلهم ممتازين؟ طيب ليش المبيعات واقفة؟" (They're all excellent? Then why are sales flat?) The product tells him nothing new.
2. **Car dealership, 12 sellers.** First screen: the dashboard. First question: "who pushes customers away?" Stuck: pushy shows nowhere except inside one recording; he would have to open 12 recordings. Says: "I want a red name at the top." Likes the evidence view and the quote of "what style is this, every time I say no you repeat". Impressed by that moment: "Wallah, this is the exact thing I hear complaints about."
3. **Multi-branch perfume chain (owner, 4 branches, 20 staff).** Wants branch comparison and top 3 scents offered. First question: "which branch?" Stuck: no branch concept; the roster is one flat list. Says: "Where are my branches?" Perfume upselling (bundles, oud sets) matches the technique card.
4. **Telecom regional manager (reports upward).** First question: "give me the number I send to head office." Stuck: three different yes-rates (G10), no export/PDF. Says: "I can't paste this into my deck." Needs weekly summary export; data-residency questions will come from his IT (R4).
5. **Sceptical owner worried about staff morale.** First question: "can they see this?" Opens Person page: finds the AI disclaimer and "optional" framing (good) but no staff view and no "what we record" statement. Stuck: nothing says staff can open their own page. Says: "If I show this to my guys without telling them, they quit. How do I introduce it?" A rollout one-pager is worth more than a new chart.
6. **Phone-only owner, 2 minutes a day.** First screen at 375 px: five tiles stacked, count-up numbers still moving, "Calm". Scrolls three screens, finds "Nobody needs support right now". Closes the app. Says: "Send me a WhatsApp if something is wrong." This owner is best served by a daily digest, not a dashboard.
7. **Appliances retailer, bilingual owner, English-speaking branch manager.** Reads Arabic quotes fine; the branch manager cannot. Stuck: no English gloss under quotes, "spoken in Other". Says: "Why does it say Other? It's Arabic." (R1 area, but here the owner-visible symptom.)
8. **Owner who loves numbers (accountant type).** Opens Team, sorts by "Customers say yes": Khalid 0%, Reem 33%, Noura 100%. Delighted... until he sees both "Excelling" and 3 conversations each. Says: "Three calls is nothing; what is the sample?" Needs the small-sample marker (G6) and the pooled/average explanation (G10).
9. **Owner who wants proof before firing/paying bonus.** Opens Khalid's recording, reads the Summary. Wants to hear the call. Stuck: no audio (R7). Says: "I'm not going to act on a paragraph."

Pattern across the 9: the **recording Summary** converts sceptics; the **dashboard/Team** page loses them. Four of nine ask for push/WhatsApp or a digest rather than a screen.

---

## 5. Top 10 changes for the "wallah, very good" reaction

Effort S = under a day, M = a few days, L = a week+. "Remove" says what to take out to pay for it.

| # | Change | Effort | Remove / simplify |
|---|---|---|---|
| 1 | **Make the dashboard's first card "Needs attention now"**: pushy-after-no, frustrated customer, unanswered questions, each as a named, clickable line ("Khalid · pushy on 14 Oct · 3 offers after a 'no' → open"). Feed it from `pushy_conversations` and `max_customer_frustration`, not only from the rating. | S | Remove the empty-state sentence "Nobody needs support right now" and the four-box rating strip above it. |
| 2 | **Real ranking.** Team defaults to sorted by "Customers say yes" (then upsell rate), rating chips replaced by "Top 3 / Needs a talk". Make the rating stricter or hide it until it separates people (G1; D mentions Khalid). | S-M | Remove the rating strip and Rating column from the default Team view. |
| 3 | **Delete the count-up animation on every headline number** (Dashboard tiles use `AnimatedNumber`; D says only Person was fixed). | S | Remove `AnimatedNumber` from `Dashboard.tsx`. |
| 4 | **Audio player on the evidence moment**, with the quote highlighted (R7). Do it for the TTS jobs on 8765 first so the demo has real sound. | M | Remove nothing; may replace "Open in full transcript" links with "Play + read". |
| 5 | **SAR value line**: "Offered SAR 22,550, accepted SAR 650 this month" and per person (G2), plus "opportunities with no offer: 9". | M | Remove "Greets customers" as a headline tile, in its place. |
| 6 | **Land owners on the recording Summary, and cut recording tabs from six to three** (Summary / Details / Transcript). | S-M | Remove Overview tab content (KPI strip, "Who spoke" bars) and the standalone Evidence tab; fold into Details. |
| 7 | **Daily owner digest** (WhatsApp, email, or an in-app "today" card): "Yesterday: 14 calls, 1 pushy (Khalid), 2 missed offers. Open." Serves the phone owner and the sceptic. | M-L | Remove the 5-tile row from the phone layout. |
| 8 | **English gloss under every Arabic quote** and "Arabic" instead of "Other" in the language label (D, R1). | S | Remove the label "spoken in Other". |
| 9 | **Small-sample and staff-trust marks**: "3 conversations - too few to rank" next to every percentage under 5 conversations; a short "what we record and who sees it" line on Person pages; show staff their own page. | S-M | Remove the "▲ 100 points" deltas when under 5 conversations. |
| 10 | **One definition per number**: pooled team rates everywhere and the same Month/Week default on Dashboard, Team and Person (read `?period=` on Person), plus a "Selling effort" rename to "Offer activity". | S | Remove the weekly vs monthly split between Team and Dashboard. |

Not in the top 10, deliberately: branch grouping (G11) and POS integration (G12) are too large for a demo, but expect the question.

---

## NOT VERIFIED

- Everything in section 1 (JTBD) and section 4 (owners) is **ASSUMED / simulated**. No owner was interviewed.
- Only Khalid's person page and his 14 Oct recording were read in full in the browser. Reem, Mohammed, Noura, Imran, Faisal pages were not opened; claims about them rest on the Team table (L3) and `saudi-demo-data.md` (read).
- "Nobody needs attention" while Reem had a delivery complaint is inferred from D plus the dashboard showing 0 "Needs support"; I did not open Reem's recording.
- Not tested: login/signup pages, user menu, the Start-recording dialog flow, uploading a file, Daily period, dark mode, accessibility, keyboard use, narrow-width of Team/Person/recording (only the dashboard was seen at 375 px), "+4 more" expansion, whether the recording chat widget is reachable.
- The count-up wrong-number observation is real (captured twice), but I did not confirm in code that it is `AnimatedNumber` and not browser timer throttling in the preview pane. Final values appeared after a few seconds on desktop; on mobile preview they were still partial after 3 s.
- The time shown (16:00) vs created time (10:30 UTC): cause not traced (browser timezone vs server).
- SAR amounts: seen only as text inside hand-written sample offers. Whether real pipeline output has reliable amounts is unverified.
- Rating thresholds quoted from `dashboard.py` lines 424-554 by reading, not by running a test.
- The Saudi sample is hand-authored (D) so what it shows is the best case, not what a real Arabic recording would produce (see ASR session's findings).
- Server on 8765 was left running and untouched; my own port-8766 server was stopped. Browser viewport was reset to desktop. No commit, no source edit. Existing uncommitted changes in the repo belong to other sessions.
