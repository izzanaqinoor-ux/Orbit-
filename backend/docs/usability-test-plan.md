# Orbit usability test plan

Goal: find out whether someone who is *not you* can make Orbit theirs without help, and whether everything they use works.
Orbit is for two kinds of people. Test each with the right person from your family.

## The two people

| | Student (e.g. a cousin, sibling) | Office worker (e.g. a parent, uncle, aunt) |
|---|---|---|
| Day | Classes, hand-ins, a part-time job | 9–6 job, bills, family dates |
| Starts from | "Student" | "Office worker" |
| Money | Allowance + job, small budget, no investing | Salary, savings goals, maybe investing |
| Words they know | Exam, hand-in, shift | Salary, bills, KPI, appraisal |
| Should NOT see | Portfolio, Roadmap, Import (unless ticked) | Study & exams, exam focus |

## How to run a session (20–30 min each)
1. Give them the link, an account to sign up with, and **nothing else**. No tour.
2. Ask them to think aloud. When they get stuck, **wait**; don't point. Write down where and for how long.
3. Hand over the tasks one at a time, as situations, not instructions ("Your mum's birthday is next Friday and you don't want to forget" rather than "add an occasion").
4. Stop a task after 3 minutes of being stuck; note it as a fail and help.
5. After the tasks, ask the questions at the bottom.

## Tasks: both people
| # | Situation | Success looks like | Watch for |
|---|---|---|---|
| 1 | You've just signed up. Make Orbit fit your life. | Picks a start, unticks something, reaches the home screen | Do they understand "hidden, not deleted"? Do they hesitate on any tick? |
| 2 | Something happens every week at a fixed time (class / gym / team meeting). Put it in. | Fixed weekly commitment on the right days | Confusion between Fixed and Flexible; the planet dropdown |
| 3 | You have a task due Friday but no set time. Add it, then find time for it. | Flexible commitment with a day-only due date, then a time block | "Plan time" discoverability |
| 4 | Your friend's birthday is next week. Make sure you don't forget. | Special occasion appears on This week | Where they first look |
| 5 | You spent S$12 on lunch today. Record it. | Expense with category in Activity | Category choice; "pockets" vs "accounts" wording |
| 6 | You want to buy something for S$150. Is it a good idea? | Planning result read correctly (can say what it told them) | Do they trust or ignore the answer? Do they notice the hours-of-work line? |
| 7 | You decided to turn off a part of Orbit you don't use, then change your mind. | Features switched off then on again | Can they find "Make Orbit yours"? |
| 8 | Look back at how your week went. | Opens Weekly review | Do they find it without being told? |

## Extra tasks: Student
| # | Situation | Success looks like |
|---|---|---|
| S1 | You have an exam in 5 days. Tell Orbit. | Fixed study commitment with "This is an exam" ticked |
| S2 | Your job pays by the hour. Tell Orbit what you earn. | Job with hourly rate under Finance → Income |
| S3 | Open the Orbit tab. What does it tell you about your week? | Can explain in their own words what the planets mean |

## Extra tasks: Office worker
| # | Situation | Success looks like |
|---|---|---|
| W1 | Tell Orbit your monthly salary. | Job or income source with monthly pay |
| W2 | You get a statement from two bank accounts. Bring both in. | Both CSVs imported; transfer between them booked once |
| W3 | Set a goal: S$6,000 emergency fund by next December. | Goal created and shown on Funds |
| W4 | (If Investing is on) Record what your investments are worth this month. | Monthly check-in completed |

## What to record per task
`Task · Done unaided? (yes / with a hint / no) · Time · Where they hesitated · What they said out loud · Wrong turns`

## Questions at the end
1. In your own words, what is Orbit for?
2. What did you expect to find that wasn't there?
3. What did you see that you didn't need? (Did "Make Orbit yours" cover it?)
4. Which word or label made you stop and think?
5. Would you open it again tomorrow? What would make you?
6. 1–5: how much does it feel like *yours*?

## Using the in-app Notes button
Testers tap **Notes** on any screen, choose **About Orbit**, and type. Each note stores the screen they were on, their words and which features they have switched on. **For me** notes stay private to them, so tell testers to pick About Orbit.

Set `ADMIN_EMAIL=your@email` (lowercase) on the backend (Render env var), then, signed in as that email, download everything at
`/admin/feedback.csv` (on the API URL). Open it in Sheets and sort by `page` to see which screens cause the most trouble.

## Reading the results
- A task nobody finishes unaided is a **design** problem, not a tester problem.
- Two people stumbling in the same place counts; one person is an anecdote.
- Fix in this order: broken things, then tasks people failed, then wording, then wishes.
- Before changing anything, note which start (Student / Office worker) the person chose. If a start is wrong for the person, that's a finding about the presets.

## What to send your testers
> I'm testing a life-planner I built. I'm testing the app, not you, so nothing you do is wrong. Please open the link, sign up, and use it as if it were really yours. Tap "Notes", choose "About Orbit", and jot something down whenever something confuses you or surprises you, even a little. I'll sit with you but I won't help unless you're stuck for a long time.
