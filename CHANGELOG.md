# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-02-08

### Added

- Quick Select overhaul: Gaussian scoring, infinite scroll, tabs (Frequent/Recent), search with food database, auto-camera on empty log
- Loading skeletons for all app routes (dashboard, analyze, history, quick-select, settings)
- Dashboard preview component with prefetched data
- Food search API endpoint for Quick Select
- Debounce hook for search input

### Changed

- Navigation restructured with bottom nav improvements
- Comprehensive performance and loading improvements across the app
- Food history component with enhanced infinite scroll

### Fixed

- Multiple UI bug fixes (FOO-224, FOO-225, FOO-226, FOO-227, FOO-228)
- PLANS.md completion status detection in skills

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
- Dual environment setup (staging with dry-run, production with live Fitbit)

[Unreleased]: https://github.com/lucaswall/food-scanner/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/lucaswall/food-scanner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/lucaswall/food-scanner/releases/tag/v1.0.0
