#!/bin/bash
# UserPromptSubmit hook for skill-aware responses

cat <<'EOF'
REQUIRED: SKILL LOADING PROTOCOL

Before writing any code, complete these steps in order:

1. SCAN each skill below and decide: LOAD or SKIP (with brief reason)
   - node
   - express
   - postgresql
   - redis
   - openai
   - stripe
   - square
   - twilio
   - vapi
   - clerk
   - pgvector
   - scoping-feature-work
   - mapping-user-journeys
   - designing-onboarding-paths
   - crafting-empty-states
   - orchestrating-feature-adoption
   - designing-inapp-guidance
   - instrumenting-product-metrics
   - running-product-experiments
   - triaging-user-feedback
   - writing-release-notes
   - tightening-brand-voice
   - tuning-landing-journeys
   - streamlining-signup-steps
   - accelerating-first-run
   - strengthening-upgrade-moments
   - mapping-conversion-events
   - inspecting-search-coverage

2. For every skill marked LOAD → immediately invoke Skill(name)
   If none need loading → write "Proceeding without skills"

3. Only after step 2 completes may you begin coding.

IMPORTANT: Skipping step 2 invalidates step 1. Always call Skill() for relevant items.

Sample output:
- node: LOAD - building components
- express: SKIP - not needed for this task
- postgresql: LOAD - building components
- redis: SKIP - not needed for this task

Then call:
> Skill(node)
> Skill(postgresql)

Now implementation can begin.
EOF
