# PDH - Revamp Plan for mobile app
- Make sure codebase is unified (desktop and mobile).
- Refactor the UI to four tabs:
    1. Chat (add a voice input feature)
    2. Skill 
    3. Memory
    4. Settings
        - Unify the current settings and activity tabs into this new tab. 
        - The user will configure their PDH system through this tab.
        - API Keys, integrations, activity log, etc

## Tab Descriptions
These are not comprehensive, and go in depth for only specific tabs that 
need a major overhaul apart from rewriting core elements of the PDH agent
loop.
### Skill
The existing message reply features must be extracted out to the skills tab.
Essentially a distilled and modifiable version of the existing skill that isn't
hardcoded. This skill is self-modifiable by the AI agent; It consists of the unchangeable
endpoints that it needs to access to send messages, but it can also create and maintain
important rules for the type of response, and related things. This isn't exactly 
a memory, but a guideline for how to use memories. This ideally should be a database entry 
or a text file that we can edit through the application. Database is better.
### Memory
The existing tab, ONLY consisting of the memories that the AI can explicitly write 
(i.e not skills).
