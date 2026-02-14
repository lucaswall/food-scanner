# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.9.0] - 2026-02-14

### Added

- Conversational food chat with WhatsApp-style UI and multi-turn refinement
- Inline analysis summaries in chat bubbles with photo attachment indicators

### Changed

- Replaced budget marker and separate analysis screen with full-screen chat experience
- Improved chat accessibility, mobile layout, and floating controls

### Fixed

- Chat refinement bugs: stale analysis, lost context, unit labels, and light mode styling
- Chat overlay z-index and safe-area padding on mobile

## [1.8.0] - 2026-02-13

### Added

- Fasting window tracking with daily start/end times and duration display
- Weekly nutrition dashboard with day-by-day breakdown
- Weekly nutrition chart with metric selector (calories, protein, carbs, fat)
- Weekly fasting chart showing fasting hours per day

### Changed

- Consolidated app theme with improved dark mode colors
- Improved confidence badges and food detail layout
- Better photo capture and description input UX

### Fixed

- Minor bug fixes across dashboard, settings, and food analysis

## [1.7.0] - 2026-02-12

### Added

- Claude API usage tracking showing costs and token consumption
- App auto-reloads when resuming tab after being away

### Changed

- Budget marker only appears on today's date, not past days

## [1.6.0] - 2026-02-11

### Added

- Date navigation to browse food logs from previous days
- API key management for programmatic access

### Fixed

- Budget marker now shows calorie ceiling instead of remaining budget

## [1.5.1] - 2026-02-11

### Fixed

- Dashboard now always displays, even when no food is logged today
- Lumen banner appears reliably on initial page load

## [1.5.0] - 2026-02-10

### Added

- Lumen metabolic tracking: upload Lumen screenshots to set daily macro goals
- Macro progress bars now show Lumen goal targets when available

### Fixed

- Lumen goals date timezone handling to ensure correct daily goal assignment
- Food history display now properly refreshes after logging

## [1.4.1] - 2026-02-10

### Fixed

- Budget marker now properly requests activity data scope during Fitbit OAuth setup
- Budget marker rotation angle calculation corrected
- Dashboard displays reconnect prompt when activity scope is missing

## [1.4.0] - 2026-02-10

### Added

- Calorie ring now shows a budget marker for calories burned vs consumed

### Changed

- More accurate AI food analysis

### Fixed

- Dashboard gracefully handles cases where calorie goal is not set

## [1.3.0] - 2026-02-10

### Added

- Daily dashboard with calorie ring, macro bars, and meal breakdown
- Extended nutritional information (saturated fat, trans fat, sugars, calories from fat)
- Nutrition facts card with detailed nutrient breakdown

### Changed

- Unified success screen after logging food

## [1.2.0] - 2026-02-09

### Added

- Fitbit setup flow for connecting your personal Fitbit account
- Food detail pages with full nutritional breakdown

### Fixed

- Data freshness issues across multiple components
- Accessibility, touch targets, and error state improvements

## [1.1.0] - 2026-02-08

### Added

- Quick Select overhaul: smart scoring, infinite scroll, Frequent/Recent tabs, food search, auto-camera on empty log
- Faster loading with skeleton placeholders across the app

### Changed

- Redesigned bottom navigation
- Food history with infinite scroll

### Fixed

- Multiple UI bug fixes

## [1.0.0] - 2026-02-08

### Added

- AI-powered food analysis from photos and text descriptions
- Automatic nutritional logging to Fitbit
- Multi-user support with Google OAuth authentication
- Fitbit OAuth integration with automatic token refresh
- Food log history with daily grouping and deletion
- Quick select for commonly logged foods
- Smart food matching to reuse previous Fitbit entries
- Refinement flow to correct AI analysis before logging
- Dark mode with system preference detection
- Mobile-first PWA with Add to Home Screen support

[Unreleased]: https://github.com/lucaswall/food-scanner/compare/v1.9.0...HEAD
[1.9.0]: https://github.com/lucaswall/food-scanner/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/lucaswall/food-scanner/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/lucaswall/food-scanner/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/lucaswall/food-scanner/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/lucaswall/food-scanner/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/lucaswall/food-scanner/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/lucaswall/food-scanner/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/lucaswall/food-scanner/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/lucaswall/food-scanner/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/lucaswall/food-scanner/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/lucaswall/food-scanner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/lucaswall/food-scanner/releases/tag/v1.0.0
