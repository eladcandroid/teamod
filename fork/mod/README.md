# teamod

A worktree and an agent per task, shared task boards and plans, teammates' agents asking each other for help, and automations, in panes beside your Claude Code session.

teamod is a fork of [teamod](https://github.com/eladcandroid/teamod)'s engine with a Claude Code mod as its screen. You don't need teamod installed, and the two networks are separate: everyone on a team needs teamod.

## Install

At the prompt of a Claude Code terminal session, with the repository you were given:

    /plugin install teamod --marketplace <owner>/<repo>

Then:

    /teamod setup

Setup needs Node 20 or newer, npm and git. It takes a few minutes the first time: it gets the engine and builds it.

## Use

`/teamod` opens the Work pane. A row of screens runs along its top: Work, Task, Team, Board, Sentinel, Settings. Click one, or press its letter while the pane has the keyboard. Esc gives the keyboard back.

What waits for you (approvals, questions, a teammate's request) shows above the prompt.

`/teamod service on` keeps the engine running from login, so schedules and teammates' requests work with Claude Code closed. Without it the engine runs from your first session until you restart.

## Your data

Everything stays in `~/.teamod` on your computer. Asks between teammates go directly from computer to computer, encrypted, and each one waits for the other person's press unless they chose otherwise.
