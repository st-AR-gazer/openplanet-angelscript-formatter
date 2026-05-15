using namespace UI;

funcdef void RunnerCallback(int code, const string &in message = "ok");
funcdef void LogCallback(const string &in fmt, ?&in... args);

enum Mode {
  None = 0,
  Fast = 1,
  Slow = 2
}

namespace Game {
shared interface IRunner {
  void Run(int count);
}

class Runner : IRunner {
  private int total = 0;

  Runner() {
    total = 1;
  }

  void Run(int count) override {
    for (int i = 0; i < count; i++) {
      if (i % 2 == 0) {
        total += i;
      } else {
        total -= i;
      }
    }
  }

  int get_Total() const {
    return total;
  }

  property int Total {
    get {
      return total;
    }
    set {
      total = value;
    }
  }
}
}

void Main() {
  Game::Runner runner();
  runner.Run(3);
  foreach (auto item in items) {
    Use(item);
  }
  switch (mode) {
    case Mode::Fast:
      RunFast();
      break;
    default:
      break;
  }
  do {
    Tick();
  } while (IsRunning());
  try {
    Risky();
  } catch {
    warn("failed");
  }
  delete runner;
  wstring label = "x";
}
