#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <mutex>  // for convenience when using std::lock_guard

class Lockable {
    bool              m_locked;
    SemaphoreHandle_t m_mutex;
    char const *      m_name;

  public:
    explicit Lockable (char const * name);
    ~Lockable();

    // Disable all copying and moving
    Lockable (const Lockable &)             = delete;
    Lockable & operator= (const Lockable &) = delete;
    Lockable (Lockable &&)                  = delete;
    Lockable & operator= (Lockable &&)      = delete;

    void lock ();
    void unlock ();

    bool locked () const { return m_locked; }

    // Expose mutex for timeout-based locking
    SemaphoreHandle_t get_mutex () const { return m_mutex; }
};
