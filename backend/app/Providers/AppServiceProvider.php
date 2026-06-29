<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiters();
    }

    /**
     * API throttles. The Laravel 11+ skeleton applies none by default, leaving
     * the public API open to scraping/DoS and the login route open to
     * brute-force — so we define them explicitly here.
     */
    private function configureRateLimiters(): void
    {
        // Public read API: generous, keyed by client IP.
        RateLimiter::for('public', fn (Request $request) => Limit::perMinute(120)->by($request->ip()));

        // Authenticated admin actions: per-user (falls back to IP pre-auth).
        RateLimiter::for('admin', fn (Request $request) => Limit::perMinute(60)
            ->by($request->user()?->id ?: $request->ip()));

        // Login: tight, keyed by email + IP so one attacker can't grind a
        // single account and one account's typos don't lock out a whole IP.
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute(5)
            ->by(strtolower((string) $request->input('email')).'|'.$request->ip()));
    }
}
