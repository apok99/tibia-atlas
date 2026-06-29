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
     * the public API open to scraping/DoS — so we define one explicitly here.
     */
    private function configureRateLimiters(): void
    {
        // Public read API: generous, keyed by client IP.
        RateLimiter::for('public', fn (Request $request) => Limit::perMinute(120)->by($request->ip()));
    }
}
