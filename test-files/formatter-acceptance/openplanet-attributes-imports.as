#if TMNEXT
[Setting category="General" name="Enabled"]
bool Enabled=true;

[Setting hidden]
string Secret="value";

import void Notify(const string &in message) from "Companion";
import int Compute(int value, int fallback = 0) from "Companion";
funcdef void CompletionCallback(int code,const string &in message);

void Main(){
  if(Enabled){
    Notify(n"ready");
  }
}
#endif
