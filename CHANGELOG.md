# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lucaswall/food-scanner/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/lucaswall/food-scanner/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/lucaswall/food-scanner/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/lucaswall/food-scanner/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/lucaswall/food-scanner/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/lucaswall/food-scanner/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/lucaswall/food-scanner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/lucaswall/food-scanner/releases/tag/v1.0.0
