# Architecture

## Purpose

A game/product prototype that combines gameplay, tasks, wallet flows, backend APIs and monetization experiments.

## Main flow

`	ext
Player -> Vite game UI -> API client -> Fastify server -> database/cache/payment services -> updated game state
`

## Design notes

The public repo keeps the product architecture visible while removing operational credentials and private VPS traces.

## Portfolio note

This repository is packaged for review. Some runtime integrations require local credentials or external services and are represented with .env.example instead of real secrets.
