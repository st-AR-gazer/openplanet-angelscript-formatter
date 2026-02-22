#if TMNEXT
[Setting hidden]
void Main() {
  auto x = 1;
  array<array<int>> vals;
  dictionary<string, array<uint>> map;
  MyType@handle = @GetHandle();
  if (true) {
    UI::Text("hello");
  } else {
    warn("bad");
  }
  DoSomethingLong(firstArg, secondArg, thirdArg, fourthArg, fifthArg);
  obj.Manager.Component.Run().WithValue(123).Apply();
// opfmt-disable-next-line
if(true){print("this line should stay untouched");}
}
#endif